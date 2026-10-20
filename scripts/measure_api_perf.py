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
"""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import json
import math
import os
import platform
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from sqlalchemy import text

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_WORKDIR = Path(tempfile.gettempdir()) / "rf17_perf_measure"
DEFAULT_DB = DEFAULT_WORKDIR / "rf17_perf_fixture.db"

# ---------------------------------------------------------------------------
# 测点清单：与 backend/app/api 实际注册的路由一一对应（配套测试
# tests/test_perf_measure_api.py::test_endpoint_routes_registered 用
# FastAPI 路由表钉住每个路径，404/改路由会让测试变红）。
# ``{knowledge_term}`` / ``{job_term}`` 在运行时用被测库里的真实数据填充，
# 保证搜索端点真正命中（而不是测一个空结果集的固定字符串）。
# ---------------------------------------------------------------------------
ENDPOINT_TEMPLATES: list[tuple[str, str, str]] = [
    ("GET", "/api/jobs?page=1&page_size=20", "job_list_page"),
    ("GET", "/api/resumes?page=1&page_size=20", "resume_list_page"),
    ("GET", "/api/tracker/page?page_size=20", "tracker_page"),
    ("GET", "/api/tracker/stats", "tracker_stats"),
    ("GET", "/api/candidate-jobs/page?page=1&page_size=20", "candidate_jobs_page"),
    ("GET", "/api/knowledge/page?page=1&page_size=20", "knowledge_page"),
    ("GET", "/api/knowledge/page?page=1&page_size=20&q={knowledge_term}", "knowledge_search"),
    ("GET", "/api/search?q={job_term}", "global_search"),
    ("GET", "/api/stats", "stats"),
]

# SLO 口径（§3.3）：普通列表类端点 p95 ≤ 300ms。这是目标值不是现状声明；
# 超限即 FAILED + 退出非零。所有端点默认同一条阈值，--slo-p95-ms 可整体放宽。
DEFAULT_SLO_P95_MS = 300.0


# ---------------------------------------------------------------------------
# 纯函数助手（模块导入无副作用，可被单元测试直接调用）。
# ---------------------------------------------------------------------------
def percentile_nearest_rank(sorted_values: list[float], pct: float) -> float:
    """最近邻秩百分位：30 个样本的 p95 = 第 ceil(0.95*30)=29 个值。"""
    if not sorted_values:
        raise ValueError("percentile_nearest_rank needs a non-empty sample list")
    rank = max(1, math.ceil(pct / 100 * len(sorted_values)))
    return sorted_values[rank - 1]


def classify_detail(detail: str) -> str:
    """把 EXPLAIN QUERY PLAN 的 detail 归类成可读标记。"""
    if "TEMP B-TREE" in detail:
        return "临时排序"
    if "SCALAR SUBQUERY" in detail or "SUBQUERY" in detail:
        return "子查询"
    if "SCAN" in detail:
        return "全表扫描（经索引）" if "USING" in detail else "全表扫描"
    if "SEARCH" in detail:
        return "索引命中" if "USING" in detail else "检索"
    return "其他"


def route_exists(app: Any, method: str, path: str) -> bool:
    """路径（可带 query string）是否命中 app 上真实注册的某条路由。

    用来钉住测点清单与路由注册的一致性：端点改名/删除后，测量脚本不该
    把 404 悄悄记成一个"样本"。判定来源用 **OpenAPI schema**（``app.openapi()``
    的 paths 表）：它是 FastAPI 从真实路由注册表派生的权威清单，不受路由
    包装形态影响（本仓库新版 FastAPI 把 ``include_router`` 包成
    ``_IncludedRouter``，静态遍历 ``app.router.routes`` 会漏掉嵌套聚合路由，
    2026-10-13 实测 ``GET /api/resumes`` 就漏了）。schema 由 FastAPI 内部缓存，
    反复调用无额外开销。
    """
    clean_path = path.split("?", 1)[0].rstrip("/") or "/"
    entry = (app.openapi().get("paths") or {}).get(clean_path)
    if not entry:
        return False
    return method.lower() in {key.lower() for key in entry}


def resolve_endpoints(terms: dict[str, str]) -> list[dict[str, str]]:
    """把测点模板里的搜索词占位符填上被测库的真实数据。"""
    resolved: list[dict[str, str]] = []
    for method, template, name in ENDPOINT_TEMPLATES:
        url = template.format(
            knowledge_term=terms.get("knowledge", ""),
            job_term=terms.get("job", ""),
        )
        resolved.append({"method": method, "url": url, "name": name})
    return resolved


def evaluate_slo(
    results: list[dict[str, Any]], default_p95_ms: float = DEFAULT_SLO_P95_MS
) -> list[dict[str, Any]]:
    """对照 SLO 阈值逐端点判定；测量出错也判 FAILED（不许静默漏过）。"""
    verdicts: list[dict[str, Any]] = []
    for result in results:
        threshold = float(result.get("slo_p95_ms", default_p95_ms))
        if "error" in result:
            verdicts.append(
                {
                    "name": result.get("name", result.get("url", "?")),
                    "url": result.get("url", ""),
                    "status": "failed",
                    "p95_ms": None,
                    "threshold_ms": threshold,
                    "detail": f"测量失败: {result['error']}",
                }
            )
            continue
        p95 = result["p95_ms"]
        status = "passed" if p95 <= threshold else "failed"
        verdicts.append(
            {
                "name": result["name"],
                "url": result["url"],
                "status": status,
                "p95_ms": p95,
                "threshold_ms": threshold,
                "detail": ""
                if status == "passed"
                else f"p95 {p95:.1f}ms 超过阈值 {threshold:.0f}ms",
            }
        )
    return verdicts


def exit_code_for(verdicts: list[dict[str, Any]]) -> int:
    """SLO 全过且无测量错误 → 0；任何 FAILED → 1（fail-closed）。"""
    return 0 if all(v["status"] == "passed" for v in verdicts) else 1


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
# 环境与硬件口径。
# ---------------------------------------------------------------------------
def _git_head_commit() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return completed.stdout.strip()
    except Exception:  # noqa: BLE001 - 无 git 环境（发布包）时如实留空
        return ""


def _cpu_name() -> str:
    name = platform.processor() or platform.machine()
    if os.name == "nt":
        try:
            completed = subprocess.run(
                ["wmic", "cpu", "get", "name"],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
            if len(lines) >= 2:
                return lines[1]
        except Exception:  # noqa: BLE001 - wmic 可能不存在，回退 platform
            pass
    return name


def _total_memory_bytes() -> int:
    try:
        if os.name == "nt":

            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            statex = _MEMORYSTATUSEX()
            statex.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(statex))
            return int(statex.ullTotalPhys)
        # POSIX 上没有统一的"物理内存总量"接口，读 /proc/meminfo 的 MemTotal。
        with open("/proc/meminfo", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) * 1024
        return 0
    except Exception:  # noqa: BLE001 - 拿不到就留 0，报告里如实显示 unknown
        return 0


def collect_environment_info(db_path: Path, mode: str, scale_label: str) -> dict[str, Any]:
    """测量口径快照：HEAD / 硬件 / Python，供报告原样引用。"""
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "git_head": _git_head_commit(),
        "mode": mode,
        "scale_label": scale_label,
        "db_path": str(db_path),
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "cpu": _cpu_name(),
        "cpu_count": os.cpu_count() or 0,
        "total_memory_bytes": _total_memory_bytes(),
        "measurement_client": "fastapi.testclient.TestClient（进程内，非真实网络/浏览器）",
    }


def prepare_environment(db_path: Path) -> str:
    """在导入 app 之前设置环境（config 在导入时读取一次环境变量）。

    直接复用 stress_seed.schema 的同一份实现，保证测量库与造数库的
    环境口径完全一致（DATABASE_URL / LOG_FILE_ENABLED / PYTHONUTF8）。
    """
    # backend 目录必须可导入（app.* 仅在调用 prepare_environment 之后 import）。
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    from stress_seed import schema as stress_schema

    return stress_schema.prepare_environment(db_path)


def _assert_engine_binds_db(engine: Any, db_path: Path) -> None:
    """断言实际绑定的引擎 URL 就是声明的 DB_PATH，而不是被指针改写过的路径。"""
    bound = getattr(engine.url, "database", None)
    if not bound or Path(str(bound)).resolve() != db_path.resolve():
        raise SystemExit(
            f"实际引擎 URL（{bound!r}）与声明输出（{str(db_path.resolve())!r}）不一致，"
            "测量将写到意料之外的库上；已拒绝执行。"
        )


# ---------------------------------------------------------------------------
# FTS 能力探测与 fixture 校验。
# ---------------------------------------------------------------------------
def probe_fts(conn: Any) -> dict[str, Any]:
    """SQLite/FTS5/trigram 能力探测（只建 temp 虚拟表，不留任何对象）。"""
    info: dict[str, Any] = {"sqlite_version": sqlite3.sqlite_version}
    for key, ddl in (
        ("fts5_available", "CREATE VIRTUAL TABLE temp.rf_fts_probe USING fts5(a)"),
        (
            "trigram_tokenizer",
            "CREATE VIRTUAL TABLE temp.rf_fts_probe_tri USING fts5(a, tokenize='trigram')",
        ),
    ):
        try:
            conn.execute(text(ddl))
            conn.execute(text("DROP TABLE IF EXISTS temp.rf_fts_probe"))
            conn.execute(text("DROP TABLE IF EXISTS temp.rf_fts_probe_tri"))
            info[key] = True
        except Exception:  # noqa: BLE001 - 能力探测失败即不可用
            info[key] = False
    rows = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'")
    ).all()
    info["knowledge_fts_table"] = bool(rows)
    return info


FTS_PLAN_SQL = (
    "SELECT knowledge_entry.id FROM knowledge_entry "
    "WHERE knowledge_entry.deleted_at IS NULL "
    "AND knowledge_entry.id IN ("
    "SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH :fts_match)"
)


def validate_database(engine: Any, terms: dict[str, str]) -> dict[str, Any]:
    """校验被测库：alembic head 一致、FTS 表存在、知识库搜索计划真的走 FTS。

    这是"测量工具有资格谈 FTS 收益"的前提：任何一条不满足都直接抛错退出，
    不允许在错误 schema 上继续产出数字。
    """
    from alembic.migration import MigrationContext
    from alembic.script import ScriptDirectory
    from app.database_migrations import build_alembic_config
    from sqlalchemy import text

    config = build_alembic_config(engine)
    expected_head = ScriptDirectory.from_config(config).get_current_head()
    report: dict[str, Any] = {"expected_head": expected_head}
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
        report["alembic_version"] = current
        report["alembic_head_matches"] = current == expected_head
        report.update(probe_fts(conn))
        report["fts_search_plan_uses_fts"] = False
        report["fts_search_plan"] = []
        if report["knowledge_fts_table"]:
            term = terms.get("knowledge") or "面试"
            escaped = term.replace('"', '""')
            plan_rows = conn.execute(
                text("EXPLAIN QUERY PLAN " + FTS_PLAN_SQL),
                {"fts_match": f'"{escaped}"'},
            ).all()
            details = [row[3] for row in plan_rows]
            report["fts_search_plan"] = details
            report["fts_search_plan_uses_fts"] = any(
                "knowledge_fts" in detail for detail in details
            )
    problems = []
    if not report["alembic_head_matches"]:
        problems.append(
            f"alembic 版本 {report['alembic_version']!r} != 迁移链 head {expected_head!r}"
        )
    if not report["knowledge_fts_table"]:
        problems.append("knowledge_fts 表不存在（迁移 0044 未生效，FTS 搜索路径无从谈起）")
    if report["knowledge_fts_table"] and not report["fts_search_plan_uses_fts"]:
        problems.append("知识库搜索的 EXPLAIN QUERY PLAN 未命中 knowledge_fts")
    if problems:
        raise SystemExit("被测库校验失败（拒绝产出误导性数字）:\n  - " + "\n  - ".join(problems))
    return report


def derive_search_terms(engine: Any) -> dict[str, str]:
    """从被测库现取搜索词：知识库取第一条标题，岗位取第一条标题。

    保证搜索端点真的命中数据（测一个必然空结果的词没有意义）。词太短
    （<3 字符）时 FTS 会回退 LIKE，这里优先取内容里的长词兜底。
    """
    from sqlalchemy import text

    terms: dict[str, str] = {}
    with engine.connect() as conn:
        knowledge_row = conn.execute(
            text("SELECT title, content FROM knowledge_entry WHERE deleted_at IS NULL LIMIT 1")
        ).first()
        if knowledge_row:
            term = (knowledge_row[0] or "").strip()
            if len(term) < 3:
                term = (knowledge_row[1] or "").strip()[:12]
            if len(term) >= 3:
                terms["knowledge"] = term
        job_row = conn.execute(
            text("SELECT title FROM job WHERE deleted_at IS NULL LIMIT 1")
        ).first()
        if job_row:
            term = (job_row[0] or "").strip()
            if len(term) >= 3:
                terms["job"] = term
    return terms


# ---------------------------------------------------------------------------
# Fixture 构造：真实 Alembic head 建库 + ORM 灌数据。内容字段按真实使用
# 长度造（JD 数千字符、备注数百字符），全部为虚构数据。
# ---------------------------------------------------------------------------
_COMPANIES = ["星河科技", "云帆网络", "深蓝智能", "远航数据", "临港软件", "青崖信息"]
_CITIES = ["上海", "北京", "深圳", "杭州", "成都", "武汉"]
_TITLES = ["后端开发工程师", "前端开发工程师", "测试开发工程师", "数据分析师", "算法工程师"]
_JOB_TYPES = ["校招", "社招", "实习"]


def _jd_text(index: int) -> str:
    """一段约 2000 字的虚构 JD 正文，模拟真实岗位描述的体量。"""
    paragraphs = []
    for section in range(5):
        lines = [f"第{index}号岗位职责段落{section}：负责平台第{section}模块的设计与实现。"]
        for i in range(10):
            lines.append(
                f"条目{i}：参与需求评审、技术方案设计与代码评审，跟进线上问题排查与"
                f"性能优化，与产品、测试协作保障迭代质量；编写单元测试与接口文档，"
                f"沉淀团队技术资产（fixture-{index}-{section}-{i}）。"
            )
        paragraphs.append("\n".join(lines))
    return "\n\n".join(paragraphs)


def _commit_in_batches(session: Any, rows: list[Any], batch: int = 500) -> None:
    """分批 flush 避免一次性占用过多内存。"""
    pending: list[Any] = []
    for row in rows:
        pending.append(row)
        if len(pending) >= batch:
            session.add_all(pending)
            session.commit()
            pending = []
    if pending:
        session.add_all(pending)
        session.commit()


def _make_jobs(count: int) -> list[Any]:
    from app.models.job import Job

    return [
        Job(
            title=f"{_TITLES[i % len(_TITLES)]}（fixture{i}）",
            company=_COMPANIES[i % len(_COMPANIES)],
            location=_CITIES[i % len(_CITIES)],
            salary=f"20-{30 + i % 10}k·{(i % 14) + 1}薪",
            job_type=_JOB_TYPES[i % len(_JOB_TYPES)],
            description=_jd_text(i),
            requirements="本科及以上学历，计算机相关专业；熟悉常用数据结构与算法；"
            "有扎实的编程功底与良好的协作沟通能力。",
            additional_info="五险一金、弹性工作、年度体检、免费三餐。",
            keywords=[{"name": "Python", "category": "编程语言"}],
            source="手动添加",
            status="开放中" if i % 5 else "已投递",
            note=f"备注：第{i}条岗位的沟通记录（约 200 字）" * 6,
            favorite=i % 17 == 0,
        )
        for i in range(count)
    ]


def _make_resumes(count: int, job_ids: list[int]) -> list[Any]:
    from app.models.resume import ResumeRecord

    content_template = {
        "basics": {"name": "测试用户", "email": "fixture@example.com", "phone": "13800000000"},
        "education": [{"school": "示例大学", "major": "计算机科学与技术", "degree": "本科"}],
        "experience": [
            {
                "company": _COMPANIES[i % len(_COMPANIES)],
                "role": "实习生",
                "highlights": [f"负责模块{i % 8}的开发与优化，交付了{i % 5}个需求。"],
            }
            for i in range(4)
        ],
        "skills": [{"name": "Python", "level": "熟练"}, {"name": "SQL", "level": "熟练"}],
    }
    return [
        ResumeRecord(
            title=f"测试简历-{i}",
            job_id=job_ids[i % len(job_ids)] if job_ids else None,
            job_title=_TITLES[i % len(_TITLES)],
            company=_COMPANIES[i % len(_COMPANIES)],
            content=content_template,
            source="ai" if i % 2 else "manual",
            model="fixture-model" if i % 2 else "",
            note=f"第{i}份简历的备注",
        )
        for i in range(count)
    ]


def _make_tracks(count: int, job_ids: list[int]) -> list[Any]:
    from app.models.tracker import (
        STATUS_APPLIED,
        STATUS_ASSESSMENT,
        STATUS_INTERVIEW,
        STATUS_OFFER,
        STATUS_REJECTED,
        STATUS_SCREENING,
        ApplicationTrack,
        normalize_key,
    )

    statuses = [
        STATUS_APPLIED,
        STATUS_SCREENING,
        STATUS_ASSESSMENT,
        STATUS_INTERVIEW,
        STATUS_OFFER,
        STATUS_REJECTED,
    ]
    rows = []
    for i in range(count):
        company = _COMPANIES[i % len(_COMPANIES)]
        title = f"{_TITLES[i % len(_TITLES)]}（进度{i}）"
        rows.append(
            ApplicationTrack(
                company=company,
                title=title,
                company_key=normalize_key(company),
                title_key=normalize_key(title),
                status=statuses[i % len(statuses)],
                stage_note="一面" if i % 3 == 0 else "",
                applied_at=f"2026-09-{(i % 28) + 1:02d}",
                status_date=f"2026-10-{(i % 8) + 1:02d}",
                next_action="等待面试反馈",
                note=f"第{i}条进度记录备注" * 5,
                evidence=f"来自第{i}封通知的摘录",
                job_id=job_ids[i % len(job_ids)] if job_ids else None,
            )
        )
    return rows


def _make_candidates(count: int) -> list[Any]:
    from app.models.material import CandidateJob

    return [
        CandidateJob(
            title=f"候选岗位-{i}",
            company=_COMPANIES[i % len(_COMPANIES)],
            raw_text=_jd_text(i)[:1500],
            note=f"候选备注{i}",
            status="pending" if i % 4 else "imported",
            location=_CITIES[i % len(_CITIES)],
            salary=f"{15 + i % 10}k-{25 + i % 10}k",
            description=_jd_text(i),
        )
        for i in range(count)
    ]


def _make_knowledge(count: int) -> list[Any]:
    from app.models.knowledge_entry import KnowledgeEntry

    return [
        KnowledgeEntry(
            title=f"知识条目-{i}",
            category=["面经", "技术笔记", "求职心得"][i % 3],
            tags=[f"标签{i % 7}", "fixture"],
            content=("这是一条用于性能测量的虚构知识库正文。" * 40) + f"（编号{i}）",
            source="手动录入",
        )
        for i in range(count)
    ]


def _make_home_stats_rows(job_ids: list[int]) -> list[Any]:
    from app.models.apply import ApplyQueueItem
    from app.models.claim import ClaimRecord

    rows: list[Any] = []
    for i in range(20):
        company = _COMPANIES[i % len(_COMPANIES)]
        rows.append(
            ClaimRecord(
                title=f"虚构事实条目{i}",
                subject=company,
                source_fact=f"在{company}负责模块设计与实现（fixture 第{i}条）。",
                verification_status="pending",
            )
        )
    rows.extend(
        ApplyQueueItem(
            job_id=job_ids[i % len(job_ids)] if job_ids else None,
            job_title=_TITLES[i % len(_TITLES)],
            company=_COMPANIES[i % len(_COMPANIES)],
            status="pending",
        )
        for i in range(10)
    )
    return rows


def build_fixture_database(db_path: Path, counts: dict[str, int]) -> dict[str, Any]:
    """用真实 Alembic head 建库并灌入虚构数据；返回 schema/引擎信息。

    专用引擎由 stress_seed.schema.create_engine_for 创建并钉住绑定路径；
    app.database 的引擎（TestClient 用的那个）指向同一个文件，导入后另作
    绑定断言。
    """
    if db_path.exists():
        raise SystemExit(f"fixture 库已存在，请先删除或换 --db 路径：{db_path}")
    db_path.parent.mkdir(parents=True, exist_ok=True)

    from sqlalchemy.orm import sessionmaker
    from stress_seed import schema as stress_schema

    stress_schema.prepare_environment(db_path)
    # 注册全部模型（只导入，不建表——建表交给 Alembic）。
    tables, _ = stress_schema.load_app_metadata()
    engine = stress_schema.create_engine_for(db_path)
    try:
        schema_head = stress_schema.init_schema(engine)
        session = sessionmaker(bind=engine)()
        try:
            started = time.perf_counter()
            _commit_in_batches(session, _make_jobs(counts["jobs"]))
            job_ids = [row[0] for row in session.execute(text("SELECT id FROM job")).all()]
            _commit_in_batches(session, _make_resumes(counts["resumes"], job_ids))
            _commit_in_batches(session, _make_tracks(counts["tracks"], job_ids))
            _commit_in_batches(session, _make_candidates(counts["candidates"]))
            _commit_in_batches(session, _make_knowledge(counts["knowledge"]))
            _commit_in_batches(session, _make_home_stats_rows(job_ids))
            elapsed = time.perf_counter() - started
        finally:
            session.close()
    except Exception:
        engine.dispose()
        raise
    print(
        f"[fixture] 岗位 {counts['jobs']} / 简历 {counts['resumes']} / 进度 {counts['tracks']} / "
        f"候选 {counts['candidates']} / 知识 {counts['knowledge']}，"
        f"灌库耗时 {elapsed:.1f}s，schema head {schema_head}"
    )
    return {
        "engine": engine,
        "schema_head": schema_head,
        "tables": sorted(tables),
        "counts": dict(counts),
    }


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
