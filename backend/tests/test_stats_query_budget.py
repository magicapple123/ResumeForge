# SPDX-License-Identifier: Apache-2.0
"""首页统计 ``/api/stats`` 的查询条数预算与响应契约（2026-10 万级数据优化批）。

perf-evidence 实测（deliverables/ResumeForge-perf-evidence-20261013.md）：
``/api/stats`` 是万级数据量下最慢的端点（p95 41.4ms，**14 条独立 SQL**）——每张表的
COUNT/SUM 各自打一次库。本批把 14 条合并为 4 条（各表计数并成一条聚合语句、
待确认台账与最近投递并成一条 UNION ALL），本文件钉住两件事：

1. **查询条数预算**：整个端点的 SQL 语句数不得超过 :data:`MAX_STATS_STATEMENTS`。
   今后往端点里加任何一条独立 COUNT（最自然的写法就是再 ``db.query(...).count()``
   一次）都会让这里变红，逼着把新计数并入现有聚合语句。
2. **响应契约**：合并前后响应 JSON 形状与数值口径逐字节不变——键集合、每个计数的
   口径（收藏/开放岗位、本周简历、关联岗位简历、待确认台账、卡住的投递、待投递队列）
   以及**软删除过滤**（统计必须排除回收站里的行，仓库纪律）全部在此钉住。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta

import pytest
from app.models.apply import QUEUE_STATUS_PENDING, ApplyQueueItem
from app.models.claim import VERIFICATION_PENDING, ClaimRecord
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.models.tracker import STALLED_DAYS, ApplicationTrack, normalize_key
from app.services import trash
from sqlalchemy import event

# 端点 SQL 语句数红线：合并后的实现是 4 条（1 条聚合计数 + 2 条最近列表 +
# 1 条 UNION ALL）。历史对照：合并前 14 条（perf-evidence 实测）。
MAX_STATS_STATEMENTS = 4

# 响应的完整键集合（与 schemas/search.py 的 Stats 字段一一对应）。
# 沿用 Stats 的字段定义顺序，任何键增删/改名都会让形状断言变红。
STATS_KEYS = (
    "job_count",
    "open_job_count",
    "resume_count",
    "week_resume_count",
    "latest_jobs",
    "latest_resumes",
    "favorite_job_count",
    "pending_claim_count",
    "pending_claims",
    "stalled_application_count",
    "apply_queue_count",
    "claim_count",
    "resume_with_job_count",
    "latest_applications",
)


@contextmanager
def _count_statements() -> Iterator[list[str]]:
    """统计 with 块内测试库引擎上执行的 SQL 语句（before_cursor_execute 事件）。"""
    from app import database

    statements: list[str] = []

    def _before_cursor_execute(_conn, _cursor, statement, _params, _context, _executemany):
        statements.append(statement)

    event.listen(database.engine, "before_cursor_execute", _before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(database.engine, "before_cursor_execute", _before_cursor_execute)


@pytest.fixture
def quiet_startup_backfill(monkeypatch):
    """掐掉启动自检的用户文件副本回填后台线程。

    该线程在 lifespan 启动时点火、在**任意时刻**对 material / user_profile / job /
    candidate_job / chat_message 做全表扫描（回填副本检查），语句会随机落进计数
    窗口，让"端点 SQL 条数"断言变成看运气。它的存在与端点本身无关，掐掉后计数
    才是确定性的。fixture 必须排在 ``client`` 之前：patch 要赶在 lifespan 启动前
    生效。
    """
    monkeypatch.setattr("app.services.user_files.schedule_backfill", lambda *a, **k: None)


def _make_track(db_session, company: str, title: str, **kwargs) -> ApplicationTrack:
    """按业务口径造进度记录：company_key/title_key 由 normalize_key 推导
    （(company_key, title_key) 有唯一约束，裸建行会让键全空互相撞）。"""
    track = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        **kwargs,
    )
    db_session.add(track)
    return track


def _seed_active_data(db_session) -> None:
    """每张被统计的表都放几行活跃数据，让"有数据时的路径"也参与计数。"""
    job = Job(title="算法工程师", company="示例公司", status=JOB_STATUS_OPEN, favorite=True)
    resume = ResumeRecord(title="后端简历", content={}, job_id=None)
    claim = ClaimRecord(
        title="主导服务端开发",
        subject="简历通",
        source_fact="带队开发",
        verification_status=VERIFICATION_PENDING,
    )
    db_session.add_all([job, resume, claim])
    _make_track(db_session, "示例公司", "算法工程师")
    db_session.add(ApplyQueueItem(job_id=job.id, status=QUEUE_STATUS_PENDING))
    db_session.commit()


def test_stats_endpoint_runs_at_most_four_statements(quiet_startup_backfill, client, db_session):
    """整个端点（含所有计数与最近列表）不得超过 4 条 SQL（合并前 14 条）。"""
    _seed_active_data(db_session)

    with _count_statements() as statements:
        response = client.get("/api/stats")

    assert response.status_code == 200
    assert len(statements) <= MAX_STATS_STATEMENTS, (
        f"/api/stats 执行了 {len(statements)} 条 SQL（预算 {MAX_STATS_STATEMENTS} 条）。"
        "请把新计数并入现有聚合语句，而不是再打一次库：\n" + "\n".join(statements)
    )


def test_stats_statement_budget_holds_on_empty_database(quiet_startup_backfill, client):
    """空库同样守预算：合并实现不能靠"有数据才走快路径"。"""
    with _count_statements() as statements:
        response = client.get("/api/stats")

    assert response.status_code == 200
    assert len(statements) <= MAX_STATS_STATEMENTS, "\n".join(statements)


def test_stats_response_shape_is_unchanged(client, db_session):
    """响应键集合与类型逐项不变（既有前端按这些键直接渲染）。"""
    _seed_active_data(db_session)

    body = client.get("/api/stats").json()

    assert tuple(body.keys()) == STATS_KEYS
    for key in (
        "job_count",
        "open_job_count",
        "resume_count",
        "week_resume_count",
        "favorite_job_count",
        "pending_claim_count",
        "stalled_application_count",
        "apply_queue_count",
        "claim_count",
        "resume_with_job_count",
    ):
        assert isinstance(body[key], int), key
    for key in ("latest_jobs", "latest_resumes", "pending_claims", "latest_applications"):
        assert isinstance(body[key], list), key
    # 数值口径抽查：一条活跃岗位/简历/台账/队列各计 1。
    assert body["job_count"] == 1
    assert body["open_job_count"] == 1
    assert body["favorite_job_count"] == 1
    assert body["resume_count"] == 1
    assert body["week_resume_count"] == 1
    assert body["resume_with_job_count"] == 0
    assert body["claim_count"] == 1
    assert body["pending_claim_count"] == 1
    assert body["apply_queue_count"] == 1
    assert body["stalled_application_count"] == 0


def test_stats_excludes_soft_deleted_from_every_count(client, db_session):
    """软删除核对：回收站里的行不进任何一个计数（仓库纪律"统计过滤软删除"）。"""
    live_job = Job(title="活跃岗位", company="在", status=JOB_STATUS_OPEN, favorite=True)
    live_resume = ResumeRecord(title="活跃简历", content={}, created_at=utcnow())
    live_claim = ClaimRecord(
        title="活跃台账", source_fact="x", verification_status=VERIFICATION_PENDING
    )
    dead_job = Job(title="回收站岗位", company="删", status=JOB_STATUS_OPEN, favorite=True)
    dead_resume = ResumeRecord(title="回收站简历", content={}, created_at=utcnow())
    dead_claim = ClaimRecord(
        title="回收站台账", source_fact="x", verification_status=VERIFICATION_PENDING
    )
    db_session.add_all([live_job, live_resume, live_claim, dead_job, dead_resume, dead_claim])
    # 卡住的投递（updated_at 早于 STALLED_DAYS）：活的一条、回收站里一条。
    stalled_cutoff = utcnow() - timedelta(days=STALLED_DAYS)
    _make_track(db_session, "在", "活跃投递")
    _make_track(db_session, "在", "卡住的投递", updated_at=stalled_cutoff - timedelta(days=1))
    _make_track(db_session, "删", "回收站卡住", updated_at=stalled_cutoff - timedelta(days=1))
    db_session.commit()
    for spec_key, row in (
        ("job", dead_job),
        ("resume", dead_resume),
        ("claim", dead_claim),
        ("track", db_session.query(ApplicationTrack).filter_by(title="回收站卡住").one()),
    ):
        trash.soft_delete(db_session, spec_key, row)
    db_session.commit()

    body = client.get("/api/stats").json()

    assert body["job_count"] == 1
    assert body["open_job_count"] == 1
    assert body["favorite_job_count"] == 1
    assert body["resume_count"] == 1
    # 本周简历只数活跃行（两条都建在本周，回收站那条必须排除）。
    assert body["week_resume_count"] == 1
    assert body["claim_count"] == 1
    assert body["pending_claim_count"] == 1
    assert [item["title"] for item in body["pending_claims"]] == ["活跃台账"]
    assert body["stalled_application_count"] == 1
    assert [item["title"] for item in body["latest_jobs"]] == ["活跃岗位"]


def test_stats_latest_lists_keep_order_and_shape(client, db_session):
    """最近列表（岗位/简历/台账/投递）的排序与条目形状不变。"""
    from app.models.apply import ITEM_STATUS_SUCCESS, ApplyTask, ApplyTaskItem

    for index in range(7):
        db_session.add(Job(title=f"岗位{index}", company=f"公司{index}"))
    # apply_task_item.task_id 非空：先建一次投递批次再挂结果条目。
    task = ApplyTask(kind="apply")
    db_session.add(task)
    db_session.flush()
    db_session.add(
        ApplyTaskItem(
            task_id=task.id, job_title="投递岗", company="投递公司", status=ITEM_STATUS_SUCCESS
        )
    )
    db_session.commit()

    body = client.get("/api/stats").json()

    # 各列表仍只取前 5 条、按创建/结束时间倒序。
    assert len(body["latest_jobs"]) == 5
    assert [item["title"] for item in body["latest_jobs"]] == [
        f"岗位{index}" for index in range(6, 1, -1)
    ]
    assert body["latest_applications"] == [
        {
            "id": body["latest_applications"][0]["id"],
            "job_title": "投递岗",
            "company": "投递公司",
            "status": "success",
            "updated_at": body["latest_applications"][0]["updated_at"],
        }
    ]


@pytest.mark.parametrize("key", STATS_KEYS)
def test_stats_keys_are_always_present(client, key):
    """空库也必须有全部键（前端按数字/数组直接渲染，缺键即 500/前端崩）。"""
    body = client.get("/api/stats").json()
    assert key in body
