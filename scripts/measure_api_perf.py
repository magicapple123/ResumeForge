# SPDX-License-Identifier: Apache-2.0
"""RF-09 后端列表 API 性能基线测量（PR-17 重构版）。

与旧版的关键差异（生产审计 PR-17）：

1. **fixture 用真实 Alembic head 建库**，不再 ``Base.metadata.create_all``——
   复用 ``scripts/stress_seed/schema.py`` 的同一份实现（``prepare_environment`` /
   ``create_engine_for`` / ``init_schema``），因此 0044 FTS5 trigram 索引与
   0045 台账表都会真实存在；并支持 ``--stress-run`` 直接测量 PR-01 造数脚本
   （``seed_stress_data.py``）产出的沙箱库，保证"被测数据 = 已验证的造数产物"。
2. **CHECKS 清单对齐真实路由**：旧版把 ``/api/knowledge``、``/api/tracker`` 等
   旧全量接口当测点；本版只测分页端点（对照 ``backend/app/api`` 实际注册的
   路由，见 :func:`route_exists` 与配套测试），FTS 搜索检查走真实搜索端点
   ``GET /api/knowledge/page?q=...``（服务层 ``knowledge_service`` 在 FTS 可用时
   自动走 MATCH），搜索词从被测库现取，保证命中。
3. **测量输出完整记录口径**：HEAD commit、数据规模、schema head、SQLite/FTS
   能力、硬件（CPU 型号 / 核数 / 内存）、冷（首次请求）与热（预热后采样）、
   采样数、p50/p95、错误率、响应体大小、单次请求 SQL 语句数（SQLAlchemy
   event listener 实测）。
4. **SLO 判定 fail-closed**：默认口径"列表类端点 p95 ≤ 300ms"，任何端点超阈值
   或测量出错都会让脚本**退出非零**并在结果里标注 FAILED——不许 exit 0 装成功。
   TestClient 的数字是进程内延迟，不能当真实浏览器/网络延迟使用，报告里必须
   如实标注口径。

运行方式（仓库根目录，Windows Git Bash）::

    # 自建 fixture（真实 Alembic head）:
    PYTHONUTF8=1 backend/.venv/Scripts/python.exe scripts/measure_api_perf.py --scale 2000
    # 测量 PR-01 造数产物（推荐，与压力数据集同源）:
    PYTHONUTF8=1 backend/.venv/Scripts/python.exe scripts/measure_api_perf.py \
        --stress-run runtime/perf-20261013/stress/stress-<...> --json runtime/perf-20261013/api-2000.json

安全边界
========
- 只使用临时目录或 ``--stress-run`` 指定的 PR-01 沙箱库，**绝不访问**
  ``backend/data/resume_forge.db`` 等真实用户库；``--stress-run`` 模式对库只读
  （测量本身是 GET 请求），结束后从不删除。
- 不发起任何模型调用与外部网络请求；被测端点全部为纯数据库读取路径。
- 自建 fixture 库在结束后删除（``--keep-db`` 可保留）。

实现按职责分在四个同目录模块里（``sys.path[0]`` 就是 ``scripts/``，所以用同目录绝对
import；脚本不是包，不要改成相对 import）：

``perf_slo``     测点清单、百分位、路由存在性、SLO 判定与退出码
``perf_env``     环境/硬件口径、环境准备、engine 绑定断言、FTS 与库校验
``perf_fixture`` 搜索词提取 + fixture 库构造（真实 Alembic head）
``perf_measure`` 压测库复用、SQL 捕获与 EXPLAIN、端点测量、FTS/LIKE 对比
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from perf_env import (
    _assert_engine_binds_db,
    collect_environment_info,
    prepare_environment,
    validate_database,
)
from perf_fixture import build_fixture_database, derive_search_terms
from perf_measure import explain_statements, fts_like_comparison, load_stress_run, measure_endpoint
from perf_slo import (  # noqa: F401 - 供测试按属性访问
    DEFAULT_SLO_P95_MS,
    ENDPOINT_TEMPLATES,
    evaluate_slo,
    exit_code_for,
    percentile_nearest_rank,
    resolve_endpoints,
    route_exists,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_WORKDIR = Path(tempfile.gettempdir()) / "rf17_perf_measure"
DEFAULT_DB = DEFAULT_WORKDIR / "rf17_perf_fixture.db"


# ---------------------------------------------------------------------------
# CLI。argparse 在任何环境/文件操作之前运行（与 stress_seed 的契约一致）。
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="RF-09/PR-17 后端列表 API 性能基线测量（进程内 TestClient，虚构 fixture 库）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--warmup", type=int, default=10, help="每端点预热次数")
    parser.add_argument("--samples", type=int, default=20, help="每端点采样次数")
    parser.add_argument(
        "--stress-run",
        type=str,
        default=None,
        metavar="DIR",
        help=(
            "直接测量 PR-01 seed_stress_data.py 产出的沙箱 run 目录（内含 stress.db 与 "
            "manifest.json）；测量对库只读，结束后不删除。与 --scale/--db 互斥。"
        ),
    )
    parser.add_argument(
        "--scale",
        type=int,
        choices=[500, 2000, 10000],
        default=None,
        help="自建 fixture 的规模档位（行数比例与 stress_seed 同源）；默认 2000",
    )
    parser.add_argument(
        "--jobs", type=int, default=None, help="自建 fixture 岗位数（覆盖 --scale 派生值）"
    )
    parser.add_argument("--resumes", type=int, default=None, help="自建 fixture 简历数")
    parser.add_argument("--tracks", type=int, default=None, help="自建 fixture 求职进度数")
    parser.add_argument("--candidates", type=int, default=None, help="自建 fixture 备选岗位数")
    parser.add_argument("--knowledge", type=int, default=None, help="自建 fixture 知识库条数")
    parser.add_argument(
        "--db", type=str, default=str(DEFAULT_DB), help="自建 fixture 的 SQLite 库路径"
    )
    parser.add_argument("--keep-db", action="store_true", help="自建模式下测量结束后保留临时库文件")
    parser.add_argument(
        "--skip-explain", action="store_true", help="跳过 EXPLAIN QUERY PLAN（只测延迟）"
    )
    parser.add_argument(
        "--slo-p95-ms", type=float, default=DEFAULT_SLO_P95_MS, help="SLO 阈值：p95 毫秒"
    )
    parser.add_argument("--fts-repeats", type=int, default=20, help="FTS/LIKE 对比的重复采样次数")
    parser.add_argument("--json", type=str, default=None, metavar="PATH", help="结果 JSON 输出路径")
    return parser


def counts_from_args(args: argparse.Namespace) -> dict[str, int]:
    """自建 fixture 的行数：--scale 派生（与 stress_seed 同源比例）+ 显式覆盖。"""
    if getattr(args, "stress_run", None):
        return {}
    scale = args.scale if args.scale is not None else 2000
    from stress_seed.counts import counts_for_scale

    derived = counts_for_scale(scale).as_dict()
    counts = {
        "jobs": derived["job"],
        "resumes": derived["resume"],
        "tracks": derived["application_track"],
        "candidates": derived["candidate_job"],
        "knowledge": derived["knowledge_entry"],
    }
    for key in counts:
        override = getattr(args, key, None)
        if override is not None:
            counts[key] = override
    return counts


# ---------------------------------------------------------------------------
# 主流程。
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.stress_run:
        run_dir = Path(args.stress_run).resolve()
        stress = load_stress_run(run_dir)
        db_path = stress["db_path"]
        counts = stress["counts"]
        mode = "stress-run"
        scale_label = f"stress({counts['jobs']} jobs)"
        if stress["manifest"].get("schema_head"):
            print(f"[stress-run] 造数时的 schema head: {stress['manifest']['schema_head']}")
    else:
        db_path = Path(args.db).resolve()
        counts = counts_from_args(args)
        mode = "build"
        scale_label = f"build({counts.get('jobs', '?')} jobs)"
        # PR-01 修复的延续：目录里残留 active.json 指针会静默重定向引擎。
        pointer = db_path.parent / "active.json"
        if pointer.exists():
            raise SystemExit(
                f"目标目录存在数据集活动指针 {pointer}，引擎可能被重定向到别的库；"
                "请换一个 --db 目录（或删除该指针文件）后重试。"
            )

    prepare_environment(db_path)

    from app import database
    from app.main import app
    from fastapi.testclient import TestClient

    _assert_engine_binds_db(database.engine, db_path)

    built_engine = None
    if mode == "build":
        built = build_fixture_database(db_path, counts)
        built_engine = built["engine"]
    else:
        print(f"[stress-run] 只读测量，结束后不删除 {db_path}")

    # TestClient 走 httpx：每个请求一条 INFO 会淹没结果表，只留告警。
    import logging

    for noisy in ("httpx", "httpx2"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    print("=" * 78)
    print("RF-09/PR-17 后端列表 API 性能基线（进程内 TestClient，虚构 fixture 库）")
    print(f"被测库: {db_path}  模式: {mode}  规模: {scale_label}")
    print(
        f"预热 {args.warmup} 次 / 采样 {args.samples} 次；SLO 口径：列表类 p95 ≤ {args.slo_p95_ms:.0f}ms"
    )
    print("=" * 78)

    terms = derive_search_terms(database.engine)
    if "knowledge" not in terms:
        raise SystemExit("被测库里没有可用的知识库搜索词（知识库为空？），FTS 检查无法进行")
    validation = validate_database(database.engine, terms)
    print(
        f"[校验] alembic head={validation['alembic_version']}  "
        f"FTS5={validation['fts5_available']}  trigram={validation['trigram_tokenizer']}  "
        f"knowledge_fts={validation['knowledge_fts_table']}  "
        f"搜索计划走 FTS={validation['fts_search_plan_uses_fts']}"
    )

    client = TestClient(app, client=("127.0.0.1", 50000))
    endpoints = resolve_endpoints(terms)

    results: list[dict[str, Any]] = []
    for endpoint in endpoints:
        result = measure_endpoint(
            client,
            database.engine,
            endpoint["method"],
            endpoint["url"],
            name=endpoint["name"],
            warmup=args.warmup,
            samples=args.samples,
        )
        result["slo_p95_ms"] = args.slo_p95_ms
        results.append(result)
        if "error" in result:
            print(f"\n{endpoint['method']} {endpoint['url']}\n  !! 测量失败：{result['error']}")
            continue
        print(
            f"\n{endpoint['method']} {endpoint['url']}\n"
            f"  cold={result['cold_ms']:8.1f}ms  p50={result['p50_ms']:8.1f}ms  "
            f"p95={result['p95_ms']:8.1f}ms  mean={result['mean_ms']:8.1f}ms\n"
            f"  响应体={result['size_bytes']:8d}B  单次 SQL 语句数={result['query_count']}  "
            f"错误率={result['error_rate']:.0%}"
        )

    verdicts = evaluate_slo(results, default_p95_ms=args.slo_p95_ms)

    print("\n" + "=" * 78)
    print("汇总（p95 对照 SLO；FAILED 会让脚本退出非零）")
    print("=" * 78)
    header = f"{'端点':44s} {'p50(ms)':>9s} {'p95(ms)':>9s} {'冷(ms)':>8s} {'响应体':>10s} {'SQL数':>5s} {'判定':>8s}"
    print(header)
    print("-" * len(header))
    for result, verdict in zip(results, verdicts, strict=False):
        if "error" in result:
            print(f"{result['name']:44s}  测量失败 -> FAILED")
            continue
        print(
            f"{result['name']:44s} {result['p50_ms']:8.1f} {result['p95_ms']:8.1f} "
            f"{result['cold_ms']:7.1f} {result['size_bytes']:9d}B {result['query_count']:5d} "
            f"{verdict['status']:>8s}"
        )

    if not args.skip_explain:
        print("\n" + "=" * 78)
        print("EXPLAIN QUERY PLAN（每端点一次真实请求捕获的语句）")
        print("=" * 78)
        for result in results:
            if "error" in result or not result.get("queries"):
                continue
            print(f"\n--- {result['name']} ---")
            explained = explain_statements(database.engine, result["queries"])
            seen: set[str] = set()
            for flag, _summary, detail in explained:
                key = detail
                if key in seen:
                    continue
                seen.add(key)
                print(f"  [{flag}] {detail}")

    comparison = fts_like_comparison(database.engine, terms["knowledge"], repeats=args.fts_repeats)
    print("\n" + "=" * 78)
    print(
        f"FTS vs LIKE（同库原始 SQL，词={comparison['term']!r}，n={comparison['repeats']}；"
        "引擎级对比口径见函数注释）"
    )
    print("=" * 78)
    print(
        f"  FTS  p50={comparison['fts_p50_ms']:8.2f}ms  p95={comparison['fts_p95_ms']:8.2f}ms  "
        f"命中={comparison['fts_hits']}\n"
        f"  LIKE p50={comparison['like_p50_ms']:8.2f}ms  p95={comparison['like_p95_ms']:8.2f}ms  "
        f"命中={comparison['like_hits']}\n"
        f"  命中数一致={comparison['fts_like_hits_consistent']}"
    )

    output: dict[str, Any] = {
        "environment": collect_environment_info(db_path, mode, scale_label),
        "fixture_counts": counts,
        "schema_validation": {k: v for k, v in validation.items() if k != "fts_search_plan"},
        "slo_p95_ms": args.slo_p95_ms,
        "endpoints": [{k: v for k, v in result.items() if k != "queries"} for result in results],
        "slo_verdicts": verdicts,
        "fts_vs_like": comparison,
        "query_plans": {
            result["name"]: [
                detail
                for _flag, _summary, detail in explain_statements(
                    database.engine, result.get("queries", [])
                )
            ]
            for result in results
            if "error" not in result and result.get("queries")
        }
        if not args.skip_explain
        else {},
    }
    if args.json:
        json_path = Path(args.json)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n结果 JSON 已写入: {json_path}")

    client.close()
    database.engine.dispose()
    if built_engine is not None:
        built_engine.dispose()
    if mode == "build" and not args.keep_db:
        # 引擎连接池还握着 SQLite 句柄，先释放否则 Windows 上删除必然失败。
        for suffix in ("", "-wal", "-shm", "-journal"):
            with contextlib.suppress(FileNotFoundError):
                Path(str(db_path) + suffix).unlink()
        with contextlib.suppress(OSError):
            db_path.parent.rmdir()

    return exit_code_for(verdicts)


if __name__ == "__main__":
    sys.exit(main())
