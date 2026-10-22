# SPDX-License-Identifier: Apache-2.0
"""测量执行：压测库复用、SQL 捕获与 EXPLAIN、端点延迟采样、FTS/LIKE 对比。

搬迁自 ``scripts/measure_api_perf.py`` 第 726–930 行（``load_stress_run``、捕获四件套、
``measure_endpoint``、``fts_like_comparison``）。
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any

from perf_slo import classify_detail, percentile_nearest_rank


def load_stress_run(run_dir: Path) -> dict[str, Any]:
    """读取 PR-01 造数 run 目录并校验其可测量性（不写入任何东西）。

    校验 manifest 存在、stress.db 存在；返回 manifest 内容与库路径。alembic
    head 与 FTS 的校验在 :func:`validate_database`（引擎建立之后）统一做。
    """
    db_path = run_dir / "stress.db"
    manifest_path = run_dir / "manifest.json"
    if not db_path.exists():
        raise SystemExit(f"--stress-run 目录里没有 stress.db：{run_dir}")
    if not manifest_path.exists():
        raise SystemExit(f"--stress-run 目录里没有 manifest.json：{run_dir}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    counts_raw = manifest.get("scale_counts", {})
    counts = {
        "jobs": counts_raw.get("job", 0),
        "resumes": counts_raw.get("resume", 0),
        "tracks": counts_raw.get("application_track", 0),
        "candidates": counts_raw.get("candidate_job", 0),
        "knowledge": counts_raw.get("knowledge_entry", 0),
    }
    print(
        f"[stress-run] {run_dir}  manifest.schema_head={manifest.get('schema_head')!r}  "
        f"jobs={counts['jobs']}"
    )
    return {"db_path": db_path, "manifest": manifest, "counts": counts}


# ---------------------------------------------------------------------------
# SQL 捕获：挂在引擎上的事件监听，记录一次请求里真实执行的语句与绑定参数。
# ---------------------------------------------------------------------------
_captured: list[tuple[str, object]] = []


def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ARG001
    _captured.append((statement, parameters))


def start_capture(engine: Any) -> None:
    import sqlalchemy

    sqlalchemy.event.listen(engine, "before_cursor_execute", _before_cursor_execute)


def stop_capture(engine: Any) -> None:
    import sqlalchemy

    sqlalchemy.event.remove(engine, "before_cursor_execute", _before_cursor_execute)


def explain_statements(engine: Any, rows: list[tuple[str, object]]) -> list[tuple[str, str, str]]:
    """对捕获到的语句跑 EXPLAIN QUERY PLAN，返回 (标记, 语句摘要, detail) 列表。

    绑定参数原样传回：计划可能依赖参数值（例如 LIKE 前缀优化），不猜、不替换。
    走 sqlite3 原生游标而不是 SQLAlchemy ``conn.execute(text(...))``：后者把
    list 参数当成 executemany（要求元素是 dict），而捕获到的 qmark 风格参数
    就是普通列表。
    """
    results: list[tuple[str, str, str]] = []
    with engine.connect() as conn:
        dbapi_conn = conn.connection.dbapi_connection
        for statement, parameters in rows:
            summary = " ".join(statement.split())
            if len(summary) > 160:
                summary = summary[:157] + "..."
            try:
                raw_cursor = dbapi_conn.cursor()
                try:
                    bind = parameters
                    if isinstance(bind, list) and bind and isinstance(bind[0], dict):
                        bind = bind[0]
                    raw_cursor.execute("EXPLAIN QUERY PLAN " + statement, bind or [])
                    details = [f"{row[3]}" for row in raw_cursor.fetchall()]
                finally:
                    raw_cursor.close()
            except Exception as exc:  # noqa: BLE001 - 单条解释失败不影响整体
                results.append(("解释失败", summary, f"{type(exc).__name__}: {exc}"))
                continue
            for detail in details:
                results.append((classify_detail(detail), summary, detail))
    return results


# ---------------------------------------------------------------------------
# 延迟测量：冷（首次请求）→ 预热 N 次 → 采样 N 次，最近邻秩百分位。
# ---------------------------------------------------------------------------
def measure_endpoint(
    client: Any,
    capture_engine: Any,
    method: str,
    url: str,
    *,
    name: str = "",
    warmup: int = 10,
    samples: int = 20,
) -> dict[str, Any]:
    """冷/热两档测量一个端点，顺带捕获一轮真实 SQL 与响应体大小。"""
    result: dict[str, Any] = {
        "method": method,
        "url": url,
        "name": name,
        "warmup": warmup,
        "samples": samples,
    }
    # 冷请求：进程内首次真实执行（含首次连接、首次加载等一次性成本）。
    cold_started = time.perf_counter()
    cold_resp = client.request(method, url)
    result["cold_ms"] = (time.perf_counter() - cold_started) * 1000
    if cold_resp.status_code != 200:
        result["error"] = f"HTTP {cold_resp.status_code}: {cold_resp.text[:120]}"
        return result

    for _ in range(warmup):
        resp = client.request(method, url)
        if resp.status_code != 200:
            result["error"] = f"HTTP {resp.status_code}: {resp.text[:120]}"
            return result
    durations_ms: list[float] = []
    size_bytes = 0
    errors: list[str] = []
    for _ in range(samples):
        started = time.perf_counter()
        resp = client.request(method, url)
        durations_ms.append((time.perf_counter() - started) * 1000)
        if resp.status_code != 200:
            errors.append(f"HTTP {resp.status_code}: {resp.text[:120]}")
            continue
        size_bytes = len(resp.content)
    result["error_count"] = len(errors)
    result["error_rate"] = len(errors) / samples if samples else 0.0
    if errors:
        result["error_detail"] = errors[0]
    if len(errors) == samples:
        result["error"] = errors[0]
        return result

    # 捕获一轮真实 SQL（预热后单独再来一次，保证计数稳定）。
    _captured.clear()
    start_capture(capture_engine)
    try:
        client.request(method, url)
    finally:
        stop_capture(capture_engine)
    queries = list(_captured)
    _captured.clear()

    ordered = sorted(durations_ms)
    result.update(
        {
            "p50_ms": percentile_nearest_rank(ordered, 50),
            "p95_ms": percentile_nearest_rank(ordered, 95),
            "mean_ms": statistics.fmean(durations_ms),
            "max_ms": ordered[-1],
            "min_ms": ordered[0],
            "size_bytes": size_bytes,
            "query_count": len(queries),
            "queries": queries,
        }
    )
    return result


def fts_like_comparison(engine: Any, term: str, repeats: int = 20) -> dict[str, Any]:
    """同一库上 FTS MATCH 与 LIKE 的原始 SQL 延迟对比。

    口径说明：这是**同库两条等价 SQL**的引擎级对比（FTS 走服务层同款
    ``id IN (SELECT rowid FROM knowledge_fts MATCH ...)`` 形态，LIKE 走迁移 0044
    之前的旧路径），不是"关掉 FTS 再测端点"——那需要改生产代码，超出测量
    脚本的边界。两者都对未删除行计数，结果集大小一并列出供核对语义。
    """
    from sqlalchemy import text

    escaped = term.replace('"', '""')
    fts_sql = (
        "SELECT count(*) FROM knowledge_entry WHERE deleted_at IS NULL "
        "AND id IN (SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH :match)"
    )
    like_sql = (
        "SELECT count(*) FROM knowledge_entry WHERE deleted_at IS NULL "
        "AND (title LIKE :like OR content LIKE :like)"
    )
    fts_ms: list[float] = []
    like_ms: list[float] = []
    fts_hits = like_hits = -1
    with engine.connect() as conn:
        for _ in range(max(1, repeats)):
            started = time.perf_counter()
            fts_hits = int(conn.execute(text(fts_sql), {"match": f'"{escaped}"'}).scalar() or 0)
            fts_ms.append((time.perf_counter() - started) * 1000)
            started = time.perf_counter()
            like_hits = int(conn.execute(text(like_sql), {"like": f"%{term}%"}).scalar() or 0)
            like_ms.append((time.perf_counter() - started) * 1000)
    ordered_fts = sorted(fts_ms)
    ordered_like = sorted(like_ms)
    return {
        "term": term,
        "repeats": repeats,
        "fts_hits": fts_hits,
        "like_hits": like_hits,
        "fts_p50_ms": percentile_nearest_rank(ordered_fts, 50),
        "fts_p95_ms": percentile_nearest_rank(ordered_fts, 95),
        "like_p50_ms": percentile_nearest_rank(ordered_like, 50),
        "like_p95_ms": percentile_nearest_rank(ordered_like, 95),
        "fts_like_hits_consistent": fts_hits == like_hits,
    }
