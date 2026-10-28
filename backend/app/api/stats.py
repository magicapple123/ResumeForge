# SPDX-License-Identifier: Apache-2.0
"""首页统计：数量概览、最近动态与"接下来做什么"。

查询条数预算（2026-10 万级数据优化批）：整个端点固定 **4 条 SQL**——
1. 全部计数并成一条聚合语句（标量子查询，每个子查询自带完整过滤口径）；
2. 最近岗位；3. 最近简历；
4. 待确认台账 + 最近投递结果并成一条 UNION ALL（各分支自带过滤与 LIMIT，
Python 侧按 kind 拆开、按各自口径排序）。
预算由 ``tests/test_stats_query_budget.py`` 钉住（合并前 14 条，perf-evidence
实测 p95 41.4ms）。往端点里加计数时**必须并入第 1 条聚合语句**，不要再打一次库。

软删除红线：每一条计数与列表都保留 ``trash.live_only`` 过滤——唯一例外是
投递队列（``apply_queue_item`` 没有 deleted_at 列，本来就不进回收站），
与合并前的口径逐条一致。
"""

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from ..database import get_db, session_engine
from ..models.apply import (
    ITEM_STATUS_SUCCESS,
    QUEUE_STATUS_PENDING,
    ApplyQueueItem,
    ApplyTaskItem,
)
from ..models.claim import VERIFICATION_PENDING, ClaimRecord
from ..models.job import JOB_STATUS_OPEN, Job
from ..models.profile import utcnow
from ..models.resume import ResumeRecord, saved_only
from ..models.tracker import ACTIVE_STATUSES, STALLED_DAYS, ApplicationTrack
from ..schemas.job import JobListOut
from ..schemas.resume import ResumeBrief
from ..schemas.search import PendingClaimBrief, Stats
from ..services import trash

router = APIRouter(prefix="/api/stats", tags=["stats"])

# 首页各列表的条数。够看清"最近发生了什么"即可，看全在各自的页面里。
_LATEST_LIMIT = 5

# UNION ALL 语句的分支判别值：0=待确认台账，1=最近投递结果。
_CLAIM_BRANCH = 0
_APPLICATION_BRANCH = 1


def _live_count(model: type, *filters: Any) -> Any:
    """ "活跃行数"标量子查询：**必须**带软删除过滤（统计过滤软删除是仓库纪律）。"""
    return (
        select(func.count())
        .select_from(model)
        .where(trash.live_only(model), *filters)
        .scalar_subquery()
    )


def _plain_count(model: type, *filters: Any) -> Any:
    """无软删列表的计数子查询——仅限没有 ``deleted_at`` 列的表（如投递队列）。"""
    return select(func.count()).select_from(model).where(*filters).scalar_subquery()


def _latest_todo_rows(db: Session) -> list:
    """待确认台账（前 5）与最近投递结果（前 5）合并成的一条 UNION ALL。

    两个列表互不相关却都是"前 5 条"，各占一条独立查询太浪费；并成一条语句后
    各分支仍保留自己的 WHERE / ORDER BY / LIMIT（包在子查询里），Python 侧按
    ``kind`` 拆开再按各自口径排一次序——排序在 Python 里重做是刻意的：复合
    SELECT 之后的行序不构成契约，与其依赖子查询顺序不如显式排序。
    """
    claim_branch = (
        select(
            literal(_CLAIM_BRANCH).label("kind"),
            ClaimRecord.id.label("id"),
            ClaimRecord.title.label("title"),
            ClaimRecord.subject.label("subject"),
            literal("").label("company"),
            ClaimRecord.verification_status.label("status"),
            ClaimRecord.updated_at.label("sort_at"),
        )
        .where(
            trash.live_only(ClaimRecord),
            ClaimRecord.verification_status == VERIFICATION_PENDING,
        )
        .order_by(ClaimRecord.updated_at.desc())
        .limit(_LATEST_LIMIT)
        .subquery()
    )
    application_sort = func.coalesce(ApplyTaskItem.finished_at, ApplyTaskItem.created_at)
    application_branch = (
        select(
            literal(_APPLICATION_BRANCH).label("kind"),
            ApplyTaskItem.id.label("id"),
            ApplyTaskItem.job_title.label("title"),
            literal("").label("subject"),
            ApplyTaskItem.company.label("company"),
            ApplyTaskItem.status.label("status"),
            application_sort.label("sort_at"),
        )
        .where(ApplyTaskItem.status == ITEM_STATUS_SUCCESS, trash.live_only(ApplyTaskItem))
        .order_by(application_sort.desc())
        .limit(_LATEST_LIMIT)
        .subquery()
    )
    merged = select(claim_branch).union_all(select(application_branch)).subquery()
    return list(db.execute(select(merged)).all())


def _sort_desc_nulls_last(rows: list, key) -> None:
    """按 ``key`` 倒序原地排序，NULL 排最后（与 SQL ``ORDER BY ... DESC`` 一致：
    SQLite 把 NULL 当最小值，DESC 时排在末尾）。"""
    rows.sort(key=lambda row: (key(row) is not None, key(row)), reverse=True)


@router.get("/storage")
def get_storage_stats(db: Session = Depends(get_db)) -> dict:
    """各项本地目录的磁盘占用（RF-25）：只统计体积与文件数，不返回任何文件内容。"""
    from ..services.storage_stats import storage_overview

    return storage_overview(session_engine(db))


def _cleanup_categories(raw: Any) -> set[str] | None:
    """把请求里的清理类别归一成集合。

    ``None``（没传该字段）= 全部类别；**空集合** = 用户取消全选，什么都不清。
    两种情形必须区分：把"空"当成"全部"会让取消勾选变成"更彻底地清"。
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple, set)):
        raise ValueError("categories 必须是字符串数组")
    values: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("categories 必须是字符串数组")
        values.extend(part.strip() for part in item.split(",") if part.strip())
    return set(values)


@router.get("/storage/cleanup-preview")
def cleanup_preview(
    older_than_days: int = Query(default=30, ge=1, le=3650),
    categories: list[str] | None = Query(
        default=None,
        description="要扫描的类别（可重复传，也可逗号分隔）：backups / backup-trash / "
        "auto-backups / logs。不传=全部；传空=什么都不清。",
    ),
) -> dict:
    """清理预览（R19）：列出超过保留期的备份与日志，只 stat 不读内容、不做任何删除。

    预览与执行吃**同一份** ``categories`` 语义与同一份 ``plan_cleanup``，所以"预览看到
    的就是执行会移走的"。未知类别返回 400 并列出合法值，而不是静默当成"全部"。
    """
    from ..services.cleanup import plan_cleanup

    try:
        selected = _cleanup_categories(categories)
        return plan_cleanup(older_than_days=older_than_days, categories=selected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/storage/cleanup")
def cleanup_now(body: dict | None = None) -> dict:
    """执行清理（R19）：候选文件移入 ``.cleanup-trash/<时间戳>/``，永不硬删。"""
    from ..services.cleanup import DEFAULT_RETENTION_DAYS, run_cleanup

    payload = body if isinstance(body, dict) else {}
    raw = payload.get("older_than_days", DEFAULT_RETENTION_DAYS)
    try:
        days = max(1, min(3650, int(raw)))
    except (TypeError, ValueError):
        days = DEFAULT_RETENTION_DAYS
    raw_paths = payload.get("paths")
    paths: set[str] | None = None
    if raw_paths is not None:
        if not isinstance(raw_paths, (list, tuple, set)):
            raise HTTPException(status_code=400, detail="paths 必须是字符串数组")
        if any(not isinstance(item, str) for item in raw_paths):
            raise HTTPException(status_code=400, detail="paths 必须是字符串数组")
        paths = {item.strip() for item in raw_paths if item.strip()}
    try:
        selected = _cleanup_categories(payload.get("categories"))
        return run_cleanup(older_than_days=days, categories=selected, paths=paths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=Stats)
def get_stats(db: Session = Depends(get_db)):
    week_ago = utcnow() - timedelta(days=7)
    latest_jobs = (
        db.query(Job)
        .filter(trash.live_only(Job))
        .order_by(Job.created_at.desc())
        .limit(_LATEST_LIMIT)
        .all()
    )
    latest_resumes = (
        db.query(ResumeRecord)
        # 「最近简历」里不该出现还没保存的草稿（0051）。
        .filter(trash.live_only(ResumeRecord), saved_only())
        .order_by(ResumeRecord.created_at.desc())
        .limit(_LATEST_LIMIT)
        .all()
    )

    # 全部计数并入这一条聚合语句（10 个标量子查询，一次 round-trip）。口径与
    # 合并前逐条一致，新增计数请加在这里，不要另开查询。
    (
        job_count,
        open_job_count,
        favorite_job_count,
        resume_count,
        resume_with_job_count,
        week_resume_count,
        claim_count,
        pending_claim_count,
        stalled_application_count,
        apply_queue_count,
    ) = db.execute(
        select(
            _live_count(Job),
            _live_count(Job, Job.status == JOB_STATUS_OPEN),
            _live_count(Job, Job.favorite.is_(True)),
            # 三个简历计数都排除草稿：一份还没保存的空白简历算进"我有几份简历"是错的（0051）。
            _live_count(ResumeRecord, saved_only()),
            # "第一份交付"进度用的两个总量：关联了岗位的简历数与台账总数
            # （含各核实状态的活跃行）。都排除回收站。
            _live_count(ResumeRecord, saved_only(), ResumeRecord.job_id.isnot(None)),
            _live_count(ResumeRecord, saved_only(), ResumeRecord.created_at >= week_ago),
            _live_count(ClaimRecord),
            _live_count(ClaimRecord, ClaimRecord.verification_status == VERIFICATION_PENDING),
            # 进行中的投递里久未更新的单独计数："卡住了"比"在推进"更需要用户去看。
            # 阈值与判定口径来自 ``models/tracker``，求职看板的 ``stalled_count``
            # 读的是同一份（test_stalled_count_matches_stats_endpoint 钉住一致）；
            # ``(now - updated_at) > 7d`` 与 ``is_stalled`` 严格等价。
            _live_count(
                ApplicationTrack,
                ApplicationTrack.status.in_(tuple(ACTIVE_STATUSES)),
                ApplicationTrack.updated_at < utcnow() - timedelta(days=STALLED_DAYS),
            ),
            _plain_count(ApplyQueueItem, ApplyQueueItem.status == QUEUE_STATUS_PENDING),
        )
    ).one()

    todo_rows = _latest_todo_rows(db)
    claim_rows = [row for row in todo_rows if row.kind == _CLAIM_BRANCH]
    _sort_desc_nulls_last(claim_rows, lambda row: row.sort_at)
    application_rows = [row for row in todo_rows if row.kind == _APPLICATION_BRANCH]
    _sort_desc_nulls_last(application_rows, lambda row: row.sort_at)

    return Stats(
        job_count=job_count,
        open_job_count=open_job_count,
        resume_count=resume_count,
        claim_count=claim_count,
        resume_with_job_count=resume_with_job_count,
        week_resume_count=week_resume_count,
        # 首页卡片同样只读摘要（RR-08）；JD 全文按 id 单取。
        latest_jobs=[JobListOut.model_validate(row) for row in latest_jobs],
        latest_resumes=[ResumeBrief.model_validate(row) for row in latest_resumes],
        favorite_job_count=favorite_job_count,
        pending_claim_count=pending_claim_count,
        pending_claims=[
            PendingClaimBrief(id=row.id, title=row.title or row.subject or "未命名主张")
            for row in claim_rows
        ],
        stalled_application_count=stalled_application_count,
        apply_queue_count=apply_queue_count,
        latest_applications=[
            {
                "id": row.id,
                "job_title": row.title,
                "company": row.company,
                # 状态与快照字段二选一：条目可能来自已被删除的岗位。
                "status": row.status,
                "updated_at": row.sort_at.isoformat() if row.sort_at else "",
            }
            for row in application_rows
        ],
    )
