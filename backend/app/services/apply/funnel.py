# SPDX-License-Identifier: Apache-2.0
"""投递后的跟进闭环与漏斗口径（14C / 14F）。

三件事，都只读窗口内的**动作量**，与 ``services/analytics.py`` 的"长期转化率"分工明确：

- :func:`summary` —— 页头漏斗条：最近 N 天投了多少、成/败多少、现在几个在面；
- :func:`stale_records` —— "7 天无回音"清单：投出去 N 天、进度仍停在 applied/screening；
- :func:`link_track` —— 一键把投递记录写成求职进度（**先查重**，不重复建）。

14C 为什么必须查重：进度表靠 ``(company_key, title_key)`` 唯一约束合并，而投递记录是
**动作**（同一个岗位可以投多次）。不做查重的话每点一次"更新进度"就多一条漏斗记录，
漏斗与面试率立刻失真，而用户不会想到是自己点出来的。

与 ``services/submit_confirmation``（「我已提交」）的分工：那个入口是"用户亲手确认自己
投了"，会额外建 HR 回复提醒、且只接受成功记录；这里只是"把这条记录写进进度"，轻量、
无副作用。两者都经 ``tracker`` 写库，合并键同一处实现，不会产生两条进度。
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    ApplyTaskItem,
)
from ...models.job import Job
from ...models.profile import utcnow
from ...models.tracker import (
    CHANNEL_PLATFORM,
    CHANNEL_UNKNOWN,
    SOURCE_APPLY,
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_RANK,
    STATUS_SCREENING,
    ApplicationTrack,
    normalize_key,
)
from ...schemas.apply import (
    ApplyStaleListOut,
    ApplyStaleRecordOut,
    ApplySummaryOut,
    ApplyTrackLinkOut,
)
from ...schemas.tracker import TrackCreate
from .. import tracker, trash
from ._base import ApplyConflict, ApplyNotFound
from ._queue import job_apply_site

logger = logging.getLogger(__name__)

# 「投出去还没回音」的进度状态：再往后（测评/面试/Offer/已结束）就不该催用户了。
_SILENT_STATUSES: tuple[str, ...] = (STATUS_APPLIED, STATUS_SCREENING)
# 「正在面试及以后」= 漏斗里 rank ≥ 面试的状态（口径由 STATUS_RANK 单一出处推导，
# 以后加状态不用再改这里）。
_INTERVIEWING_STATUSES: tuple[str, ...] = tuple(
    status for status, rank in STATUS_RANK.items() if rank >= STATUS_RANK[STATUS_INTERVIEW]
)

DEFAULT_DAYS = 7


def _window_start(days: int) -> datetime:
    """窗口起点：``days`` 天前的 00:00（UTC，与库里的无时区时间戳同一口径）。

    用自然日边界而不是"now - days*24h"：用户在 7 天窗口里想看到的是"这 7 个自然日"，
    按小时切会漏掉第 7 天后半天的记录。
    """
    start = utcnow() - timedelta(days=max(1, days) - 1)
    return start.replace(hour=0, minute=0, second=0, microsecond=0)


def _as_date(value: datetime | None) -> str:
    return value.date().isoformat() if value is not None else ""


def summary(db: Session, days: int = DEFAULT_DAYS) -> ApplySummaryOut:
    """最近 ``days`` 天的执行量 + 面试中快照。

    ``applied`` = 真正动过手的记录数（成功 + 失败）；``skipped`` 不算投递（那是"没投"）。
    ``interviewing`` 是**快照**、不受窗口限制：它回答"现在有几个在面"，按窗口裁剪会让
    它变成"最近 7 天推进到面试的个数"，与漏斗条的用途不符。
    """
    start = _window_start(days)
    rows = (
        db.query(ApplyTaskItem.status, func.count())
        .filter(
            trash.live_only(ApplyTaskItem),
            ApplyTaskItem.created_at >= start,
        )
        .group_by(ApplyTaskItem.status)
        .all()
    )
    counts = {status: int(count) for status, count in rows}
    succeeded = counts.get(ITEM_STATUS_SUCCESS, 0)
    failed = counts.get(ITEM_STATUS_FAILED, 0)
    interviewing = (
        db.query(func.count(ApplicationTrack.id))
        .filter(
            trash.live_only(ApplicationTrack),
            ApplicationTrack.status.in_(_INTERVIEWING_STATUSES),
        )
        .scalar()
        or 0
    )
    return ApplySummaryOut(
        applied=succeeded + failed,
        succeeded=succeeded,
        failed=failed,
        interviewing=int(interviewing),
    )


def stale_records(db: Session, days: int = DEFAULT_DAYS) -> ApplyStaleListOut:
    """投出去 ≥ ``days`` 天、进度仍停在「已投递 / 筛选中」的记录。

    只收 ``success`` 的记录：失败的没投出去，没有"回音"可言。进度记录按 ``job_id``
    关联（一次 IN 查询，不用逐条点查）；**没有进度记录的投递不算 stale** —— 那种情况
    该做的是"更新进度"（:func:`link_track`），不是提醒用户去跟进一个系统还不知道的目标。
    """
    start = _window_start(days)
    rows = (
        db.query(ApplyTaskItem)
        .filter(
            trash.live_only(ApplyTaskItem),
            ApplyTaskItem.status == ITEM_STATUS_SUCCESS,
            ApplyTaskItem.finished_at.is_not(None),
            ApplyTaskItem.finished_at <= start,
        )
        .order_by(ApplyTaskItem.finished_at, ApplyTaskItem.id)
        .all()
    )
    job_ids = sorted({row.job_id for row in rows if row.job_id})
    tracking: dict[int, str] = {}
    if job_ids:
        track_rows = (
            db.query(ApplicationTrack.job_id, ApplicationTrack.status)
            .filter(
                trash.live_only(ApplicationTrack),
                ApplicationTrack.job_id.in_(job_ids),
            )
            .all()
        )
        tracking = {int(job_id): status for job_id, status in track_rows if job_id is not None}
    now = utcnow()
    items: list[ApplyStaleRecordOut] = []
    for row in rows:
        if row.job_id is None or tracking.get(row.job_id) not in _SILENT_STATUSES:
            continue
        applied_at = row.finished_at or row.created_at
        items.append(
            ApplyStaleRecordOut(
                record_id=row.id,
                job_id=row.job_id,
                job_title=row.job_title,
                company=row.company,
                applied_at=_as_date(applied_at),
                days=max(0, (now - applied_at).days),
            )
        )
    return ApplyStaleListOut(items=items, count=len(items))


def _find_track(
    db: Session, record: ApplyTaskItem, company: str, title: str
) -> ApplicationTrack | None:
    """查重：先按 ``job_id``（同一岗位的多次投递归一条进度），再按合并键兜底。

    兼容只查键：历史上手工建过的那条进度没有 ``job_id``，但它就是同一家公司同一个岗位，
    此时再建一条会直接撞 ``(company_key, title_key)`` 唯一约束。
    """
    if record.job_id is not None:
        by_job = (
            db.query(ApplicationTrack)
            .filter(
                trash.live_only(ApplicationTrack),
                ApplicationTrack.job_id == record.job_id,
            )
            .order_by(ApplicationTrack.id)
            .first()
        )
        if by_job is not None:
            return by_job
    return (
        db.query(ApplicationTrack)
        .filter(
            trash.live_only(ApplicationTrack),
            ApplicationTrack.company_key == normalize_key(company),
            ApplicationTrack.title_key == normalize_key(title),
        )
        .order_by(ApplicationTrack.id)
        .first()
    )


def _channel_of(job: Job | None) -> str:
    """渠道：能落到已注册站点上就是「招聘平台」，否则如实留「未知」（不替用户编渠道）。"""
    if job is None:
        return CHANNEL_UNKNOWN
    return CHANNEL_PLATFORM if job_apply_site(job) is not None else CHANNEL_UNKNOWN


def link_track(db: Session, record_id: int) -> ApplyTrackLinkOut:
    """把一条投递记录写成求职进度；已存在则**返回已有的那条**（``created=False``）。

    ``stage`` 回传当前状态码（协议值，展示名在前端语言包里），前端据此决定是提示
    "'已写进进度（已投递）'还是"跳到"更新阶段"。
    """
    record = trash.get_live(db, ApplyTaskItem, record_id)
    if record is None:
        raise ApplyNotFound("投递记录不存在或已被删除")
    job = db.get(Job, record.job_id) if record.job_id else None
    company = (record.company or (job.company if job is not None else "")).strip()
    title = (record.job_title or (job.title if job is not None else "")).strip()
    if not company or not title:
        raise ApplyConflict("这条投递记录缺少公司或岗位名称，无法写入求职进度")

    existing = _find_track(db, record, company, title)
    if existing is not None:
        return ApplyTrackLinkOut(track_id=existing.id, created=False, stage=existing.status)

    payload = TrackCreate(
        company=company,
        title=title,
        status=STATUS_APPLIED,
        applied_at=_as_date(record.finished_at or record.created_at) or date.today().isoformat(),
        job_id=record.job_id,
        resume_id=record.resume_id,
        channel=_channel_of(job),
        note=f"由投递台一键写入（投递记录 #{record.id}）",
    )
    try:
        created = tracker.create_track(db, payload, source=SOURCE_APPLY)
    except IntegrityError:
        # 并发/历史数据撞上唯一约束：那不是错误，说明已经有一条了，按"已存在"返回。
        db.rollback()
        existing = _find_track(db, record, company, title)
        if existing is None:
            logger.warning("写求职进度撞唯一约束且查不到原记录 record_id=%s", record.id)
            raise ApplyConflict("写入求职进度失败，请稍后重试") from None
        return ApplyTrackLinkOut(track_id=existing.id, created=False, stage=existing.status)
    return ApplyTrackLinkOut(track_id=created.id, created=True, stage=created.status)


__all__ = ["DEFAULT_DAYS", "link_track", "stale_records", "summary"]
