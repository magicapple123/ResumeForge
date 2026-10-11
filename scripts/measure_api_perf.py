"""RF-09 性能基线测量脚本（只测量，不修改任何业务代码）。

用途
====
在进程内构造中等规模的虚构 fixture 库（§9.4 中档规模），对后端列表类 API
做「预热 30 次 → 采样 30 次」的延迟测量，输出 p50/p95 表；同时对每次请求
捕获真实执行的 SQL 并跑 ``EXPLAIN QUERY PLAN``，报告索引使用、全表扫描与
临时排序情况。

数据口径（§3.3）：中等规模 fixture 下普通列表 API p95 ≤300ms 为目标值，
不是现状声明。测量结果如实对照，达标/未达标都只陈述事实。

运行方式（仓库根目录，Windows Git Bash）::

    PYTHONUTF8=1 backend/.venv/Scripts/python.exe scripts/measure_api_perf.py

安全边界
========
- 只使用 tempfile 下自建的临时库，**绝不访问** ``backend/data/resume_forge.db``
  等真实用户库；
- 不发起任何模型调用与外部网络请求（被测端点全部为纯数据库读取路径，
  ``/api/stats`` 也只做 SQL 聚合）；
- 不写入仓库内任何文件；临时库文件在结束后删除（``--keep-db`` 可保留）。

输出格式
========
每个端点一段::

    GET /api/jobs                      p50= 12.3ms  p95= 20.1ms  ...
    ---- SQL 捕获（N 条，去重 M 条） ----
    [1] SELECT ...                     -> SEARCH t USING INDEX ix_...

汇总表在最后统一打印，列含义：
    p50/p95   最近邻秩百分位（30 个样本）
    mean      算术平均
    max       最慢一次
    size      响应体字节数（采样中位数那次的响应大小）
    queries   单次请求触发的 SQL 语句数（含重复，用于 N+1 观察）
"""

from __future__ import annotations

import argparse
import contextlib
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# 环境准备：必须在导入 app 之前设置（config 在导入时读取一次环境变量）。
# 与 tests/conftest.py 的做法一致，但库文件放在本脚本自己的临时目录里。
# ---------------------------------------------------------------------------
PYTHONUTF8 = "1"
os.environ["PYTHONUTF8"] = PYTHONUTF8

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_DEFAULT_WORKDIR = Path(tempfile.gettempdir()) / "rf09_perf_measure"
DEFAULT_DB = _DEFAULT_WORKDIR / "rf09_perf_fixture.db"

parser = argparse.ArgumentParser(
    description="RF-09 后端列表 API 性能基线测量（进程内，虚构 fixture 库）",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter,
)
parser.add_argument("--warmup", type=int, default=30, help="每端点预热次数")
parser.add_argument("--samples", type=int, default=30, help="每端点采样次数")
parser.add_argument("--jobs", type=int, default=10_000, help="fixture 岗位数")
parser.add_argument("--resumes", type=int, default=2_000, help="fixture 简历数")
parser.add_argument("--tracks", type=int, default=5_000, help="fixture 求职进度数")
parser.add_argument("--candidates", type=int, default=1_000, help="fixture 备选岗位数")
parser.add_argument("--knowledge", type=int, default=500, help="fixture 知识库条数")
parser.add_argument("--db", type=str, default=str(DEFAULT_DB), help="fixture SQLite 库路径")
parser.add_argument("--keep-db", action="store_true", help="测量结束后保留临时库文件")
parser.add_argument(
    "--skip-explain", action="store_true", help="跳过 EXPLAIN QUERY PLAN（只测延迟）"
)
args = parser.parse_args()

DB_PATH = Path(args.db).resolve()

# 测试/测量库不承担断电恢复职责：关掉 fsync 与 WAL 落盘，让延迟数字反映查询
# 本身的成本而不是磁盘同步（与 conftest 的理由一致，但这里是自己新建的库）。
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH.as_posix()}"
os.environ["LOG_FILE_ENABLED"] = "false"  # 不往 backend/data/logs 写任何东西

from app import database  # noqa: E402
from app.database import Base  # noqa: E402
from app.main import app  # noqa: E402
from app.models.apply import ApplyQueueItem  # noqa: E402
from app.models.claim import ClaimRecord  # noqa: E402
from app.models.job import Job  # noqa: E402
from app.models.knowledge_entry import KnowledgeEntry  # noqa: E402
from app.models.material import CandidateJob  # noqa: E402
from app.models.resume import ResumeRecord  # noqa: E402
from app.models.tracker import (  # noqa: E402
    STATUS_APPLIED,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_SCREENING,
    ApplicationTrack,
    normalize_key,
)
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

# ---------------------------------------------------------------------------
# Fixture 构造：内容字段按真实使用长度造（JD 数千字符、备注数百字符），
# 全部为虚构数据（公司/岗位名由编号生成）。
# ---------------------------------------------------------------------------
_COMPANIES = ["星河科技", "云帆网络", "深蓝智能", "远航数据", "临港软件", "青崖信息"]
_CITIES = ["上海", "北京", "深圳", "杭州", "成都", "武汉"]
_TITLES = ["后端开发工程师", "前端开发工程师", "测试开发工程师", "数据分析师", "算法工程师"]
_JOB_TYPES = ["校招", "社招", "实习"]
_TRACK_STATUSES = [
    STATUS_APPLIED,
    STATUS_SCREENING,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
]


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


def _seed_jobs(session, count: int) -> list[int]:
    """插入岗位并返回 id 列表；分批 flush 避免一次性占用过多内存。"""
    jobs = []
    for i in range(count):
        jobs.append(
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
        )
        if len(jobs) >= 500:
            session.add_all(jobs)
            session.commit()
            jobs = []
    if jobs:
        session.add_all(jobs)
        session.commit()
    return [row[0] for row in session.query(Job.id).all()]


def _seed_resumes(session, job_ids: list[int], count: int) -> None:
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
    resumes = []
    for i in range(count):
        resumes.append(
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
        )
        if len(resumes) >= 500:
            session.add_all(resumes)
            session.commit()
            resumes = []
    if resumes:
        session.add_all(resumes)
        session.commit()


def _seed_tracks(session, job_ids: list[int], count: int) -> None:
    tracks = []
    for i in range(count):
        company = _COMPANIES[i % len(_COMPANIES)]
        title = f"{_TITLES[i % len(_TITLES)]}（进度{i}）"
        tracks.append(
            ApplicationTrack(
                company=company,
                title=title,
                company_key=normalize_key(company),
                title_key=normalize_key(title),
                status=_TRACK_STATUSES[i % len(_TRACK_STATUSES)],
                stage_note="一面" if i % 3 == 0 else "",
                applied_at=f"2026-09-{(i % 28) + 1:02d}",
                status_date=f"2026-10-{(i % 8) + 1:02d}",
                next_action="等待面试反馈",
                note=f"第{i}条进度记录备注" * 5,
                evidence=f"来自第{i}封通知的摘录",
                job_id=job_ids[i % len(job_ids)] if job_ids else None,
            )
        )
        if len(tracks) >= 500:
            session.add_all(tracks)
            session.commit()
            tracks = []
    if tracks:
        session.add_all(tracks)
        session.commit()


def _seed_candidates(session, count: int) -> None:
    candidates = []
    for i in range(count):
        candidates.append(
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
        )
        if len(candidates) >= 500:
            session.add_all(candidates)
            session.commit()
            candidates = []
    if candidates:
        session.add_all(candidates)
        session.commit()


def _seed_knowledge(session, count: int) -> None:
    entries = []
    for i in range(count):
        entries.append(
            KnowledgeEntry(
                title=f"知识条目-{i}",
                category=["面经", "技术笔记", "求职心得"][i % 3],
                tags=[f"标签{i % 7}", "fixture"],
                content=("这是一条用于性能测量的虚构知识库正文。" * 40) + f"（编号{i}）",
                source="手动录入",
            )
        )
        if len(entries) >= 500:
            session.add_all(entries)
            session.commit()
            entries = []
    if entries:
        session.add_all(entries)
        session.commit()


def _seed_home_stats_rows(session, job_ids: list[int]) -> None:
    """给 /api/stats 一点可聚合的数据：台账、投递队列各插少量行。"""
    claims = []
    for i in range(20):
        company = _COMPANIES[i % len(_COMPANIES)]
        claims.append(
            ClaimRecord(
                title=f"虚构事实条目{i}",
                subject=company,
                source_fact=f"在{company}负责模块设计与实现（fixture 第{i}条）。",
                verification_status="pending",
            )
        )
    session.add_all(claims)
    queue = [
        ApplyQueueItem(
            job_id=job_ids[i % len(job_ids)] if job_ids else None,
            job_title=_TITLES[i % len(_TITLES)],
            company=_COMPANIES[i % len(_COMPANIES)],
            status="pending",
        )
        for i in range(10)
    ]
    session.add_all(queue)
    session.commit()


def build_fixture() -> None:
    """建表并灌入 §9.4 中档规模的虚构数据。"""
    if DB_PATH.exists():
        raise SystemExit(f"fixture 库已存在，请先删除或换 --db 路径：{DB_PATH}")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=database.engine)
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        started = time.perf_counter()
        job_ids = _seed_jobs(session, args.jobs)
        _seed_resumes(session, job_ids, args.resumes)
        _seed_tracks(session, job_ids, args.tracks)
        _seed_candidates(session, args.candidates)
        _seed_knowledge(session, args.knowledge)
        _seed_home_stats_rows(session, job_ids)
        print(
            f"[fixture] 岗位 {args.jobs} / 简历 {args.resumes} / 进度 {args.tracks} / "
            f"候选 {args.candidates} / 知识 {args.knowledge}，"
            f"灌库耗时 {time.perf_counter() - started:.1f}s"
        )
    finally:
        session.close()


# ---------------------------------------------------------------------------
# SQL 捕获：挂在引擎上的事件监听，记录一次请求里真实执行的语句与绑定参数。
# ---------------------------------------------------------------------------
_captured: list[tuple[str, object]] = []


def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ARG001
    _captured.append((statement, parameters))


def start_capture() -> None:
    event.listen(database.engine, "before_cursor_execute", _before_cursor_execute)


def stop_capture() -> None:
    event.remove(database.engine, "before_cursor_execute", _before_cursor_execute)


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


def explain_statements(rows: list[tuple[str, object]]) -> list[tuple[str, str, str]]:
    """对捕获到的语句跑 EXPLAIN QUERY PLAN，返回 (标记, 语句摘要, detail) 列表。

    绑定参数原样传回：计划可能依赖参数值（例如 LIKE 前缀优化），
    不猜、不替换。个别无法解释的语句如实标注跳过原因。
    走 sqlite3 原生游标而不是 SQLAlchemy ``conn.execute(text(...))``：
    后者把 list 参数当成 executemany（要求元素是 dict），而捕获到的
    qmark 风格参数就是普通列表。
    """
    results: list[tuple[str, str, str]] = []
    with database.engine.connect() as conn:
        dbapi_conn = conn.connection.dbapi_connection
        for statement, parameters in rows:
            summary = " ".join(statement.split())
            if len(summary) > 160:
                summary = summary[:157] + "..."
            try:
                raw_cursor = dbapi_conn.cursor()
                try:
                    # executemany 场景的参数是「list[dict]」，取第一条解释即可
                    # （测量阶段捕获到的都是单条 SELECT，不会真的命中这个分支）。
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
# 延迟测量：预热 N 次 → 采样 N 次，最近邻秩百分位。
# ---------------------------------------------------------------------------
ENDPOINTS: list[tuple[str, str]] = [
    ("GET", "/api/jobs"),
    ("GET", "/api/resumes"),
    ("GET", "/api/tracker"),
    ("GET", "/api/tracker/page?page_size=20"),
    ("GET", "/api/candidate-jobs"),
    ("GET", "/api/candidate-jobs/page?page_size=20"),
    ("GET", "/api/knowledge"),
    ("GET", "/api/knowledge/page?page_size=20"),
    ("GET", "/api/stats"),
]


def percentile_nearest_rank(sorted_values: list[float], pct: float) -> float:
    """最近邻秩百分位：30 个样本的 p95 = 第 ceil(0.95*30)=29 个值。"""
    import math

    rank = max(1, math.ceil(pct / 100 * len(sorted_values)))
    return sorted_values[rank - 1]


def measure_endpoint(client: TestClient, method: str, url: str) -> dict:
    """对单个端点预热 + 采样，顺带捕获一次请求的 SQL 与响应大小。"""
    for _ in range(args.warmup):
        resp = client.request(method, url)
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}: {resp.text[:120]}"}
    durations_ms: list[float] = []
    size_bytes = 0
    for _ in range(args.samples):
        started = time.perf_counter()
        resp = client.request(method, url)
        durations_ms.append((time.perf_counter() - started) * 1000)
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}: {resp.text[:120]}"}
        size_bytes = len(resp.content)
    # 捕获一轮真实 SQL（预热后单独再来一次，保证计数稳定）。
    _captured.clear()
    start_capture()
    try:
        client.request(method, url)
    finally:
        stop_capture()
    queries = list(_captured)
    _captured.clear()

    ordered = sorted(durations_ms)
    return {
        "method": method,
        "url": url,
        "p50_ms": percentile_nearest_rank(ordered, 50),
        "p95_ms": percentile_nearest_rank(ordered, 95),
        "mean_ms": statistics.fmean(durations_ms),
        "max_ms": ordered[-1],
        "min_ms": ordered[0],
        "size_bytes": size_bytes,
        "query_count": len(queries),
        "queries": queries,
    }


def main() -> int:
    # TestClient 走 httpx：每个请求一条 INFO 会淹没结果表，只留告警。
    # "httpx2" 是应用侧对请求日志的别名（见 app/middleware），一并静音。
    import logging

    for noisy in ("httpx", "httpx2"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    print("=" * 78)
    print("RF-09 后端列表 API 性能基线（进程内 TestClient，虚构 fixture 库）")
    print(f"fixture 库: {DB_PATH}")
    print(f"预热 {args.warmup} 次 / 采样 {args.samples} 次；目标口径 §3.3：普通列表 p95 ≤ 300ms")
    print("=" * 78)

    build_fixture()

    # 与 tests/conftest.py 的 client 夹具一致：用回环地址客户端，规避密钥查看边界。
    client = TestClient(app, client=("127.0.0.1", 50000))

    results = []
    for method, url in ENDPOINTS:
        result = measure_endpoint(client, method, url)
        results.append(result)
        if "error" in result:
            print(f"\n{method} {url}\n  !! 测量失败：{result['error']}")
            continue
        print(
            f"\n{method} {url}\n"
            f"  p50={result['p50_ms']:8.1f}ms  p95={result['p95_ms']:8.1f}ms  "
            f"mean={result['mean_ms']:8.1f}ms  max={result['max_ms']:8.1f}ms\n"
            f"  响应体={result['size_bytes']:8d}B  单次 SQL 语句数={result['query_count']}"
        )

    print("\n" + "=" * 78)
    print("汇总（按采样口径排序）")
    print("=" * 78)
    header = f"{'端点':42s} {'p50(ms)':>9s} {'p95(ms)':>9s} {'均值(ms)':>9s} {'响应体':>10s} {'SQL数':>5s}"
    print(header)
    print("-" * len(header.expandtabs()))
    for result in results:
        if "error" in result:
            print(f"{result['method']} {result['url']:<36s}  测量失败")
            continue
        name = f"{result['method']} {result['url']}"
        target = "达标" if result["p95_ms"] <= 300 else "未达标(>300ms)"
        print(
            f"{name:42s} {result['p50_ms']:8.1f} {result['p95_ms']:8.1f} "
            f"{result['mean_ms']:8.1f} {result['size_bytes']:9d}B {result['query_count']:5d}"
            f"  {target}"
        )

    if not args.skip_explain:
        print("\n" + "=" * 78)
        print("EXPLAIN QUERY PLAN（每端点一次真实请求捕获的语句）")
        print("=" * 78)
        for result in results:
            if "error" in result or not result.get("queries"):
                continue
            print(f"\n--- {result['method']} {result['url']} ---")
            explained = explain_statements(result["queries"])
            seen: set[str] = set()
            for flag, summary, detail in explained:
                key = summary + "|" + detail
                if key in seen:
                    continue
                seen.add(key)
                print(f"  [{flag}] {detail}")
                if flag in ("解释失败",):
                    print(f"           语句: {summary}")
            if not explained:
                print("  （未捕获到语句）")

    client.close()
    if not args.keep_db:
        # 引擎连接池还握着 SQLite 句柄，先释放否则 Windows 上删除必然失败。
        database.engine.dispose()
        for suffix in ("", "-wal", "-shm", "-journal"):
            with contextlib.suppress(FileNotFoundError):
                Path(str(DB_PATH) + suffix).unlink()
        with contextlib.suppress(OSError):
            DB_PATH.parent.rmdir()
    return 0


if __name__ == "__main__":
    sys.exit(main())
