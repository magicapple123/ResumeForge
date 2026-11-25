# SPDX-License-Identifier: Apache-2.0
"""提醒到期投递（CR-22）：把「到点」变成一条真的通知，与任务卡开关解耦。

**为什么单独一个模块**：``agent_task_events`` 已承担"扫描 + 建卡 + 调度"三件事，
再塞进投递就贴到 500 行生产代码预算。投递只依赖 ``notification`` 表与提醒本身，
不碰任务卡；拆开后"关掉任务卡但提醒照响"这条语义在代码结构上就一目了然。

三条硬规则：

1. **扫描对象是 occurrence**（CR-28）：一次到期发一次通知，重复规则下每次到期各自
   提醒，而不是"整条提醒只响一次"。
2. **幂等靠条件更新**，不靠内存里的"发过了"标记：只有把 occurrence 的 ``notified_at``
   从 NULL 改成 ``moment`` 的那一次（``rowcount == 1``）才发通知；重复扫描影响 0 行。
3. **改期 / 推迟 = 重新武装**：``update_reminder`` 改期与 ``snooze_occurrence`` 都会把
   ``notified_at`` 清回 NULL，所以"改到未来再改回过去"能再提醒一次。
4. **补扫合并**：一次扫描命中多条到期（应用停机后开机）只发一条合并通知，但每条
   occurrence 都要各自更新 ``notified_at``——否则下一轮会把没发过的再发一遍。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models.notification import (
    NOTIFICATION_SEVERITY_INFO,
    NOTIFICATION_TYPE_REMINDER_DUE,
)
from ..models.profile import utcnow
from ..models.reminder import (
    REMINDER_OCCURRENCE_STATUS_PENDING,
    REMINDER_STATUS_ACTIVE,
    Reminder,
    ReminderOccurrence,
)
from ..vocabulary.reminder import (
    REMINDER_KIND_ASSESSMENT_DEADLINE,
    REMINDER_KIND_HR_REPLY,
    REMINDER_KIND_INTERVIEW,
    REMINDER_KIND_OTHER,
)
from .notifications import emit
from .reminder_service import reminder_days_until
from .settings_service import get_notify_reminder_due

logger = logging.getLogger(__name__)

#: 启动/周期补扫只回看这么多（与任务卡段同一窗口）。
BACKFILL_WINDOW = timedelta(hours=24)

#: 通知正文里的类型名（与前端提醒类型标签同一口径；未知取值原样回显，不吞信息）。
_REMINDER_KIND_LABELS: dict[str, str] = {
    REMINDER_KIND_INTERVIEW: "面试",
    REMINDER_KIND_ASSESSMENT_DEADLINE: "测评截止",
    REMINDER_KIND_HR_REPLY: "催 HR 回复",
    REMINDER_KIND_OTHER: "提醒",
}

#: inbox 保留窗口（CR-25 口径）：提醒类通知 30 天后不再出现在列表里。
NOTIFICATION_TTL = timedelta(days=30)


def _as_naive_utc(value: datetime) -> datetime:
    """全库时间口径是 naive UTC；外部若传 aware（注入时钟）先归一。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def deliver_due_reminders(
    db: Session,
    *,
    now: datetime | None = None,
    window: timedelta = BACKFILL_WINDOW,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """把窗口内到期的 pending 提醒投递成通知（幂等，与任务卡开关无关）。

    返回 ``{"enabled", "delivered", "notification_ids", "merged", "skipped"}``。
    ``skipped`` = 条件更新没抢到的行数（并发扫描的另一轮先发了）。
    """
    if enabled is None:
        enabled = get_notify_reminder_due(db)
    if not enabled:
        return {"enabled": False, "delivered": 0, "notification_ids": [], "merged": False}

    moment = _as_naive_utc(now or utcnow())
    cutoff = moment - window
    due_rows = db.execute(
        select(ReminderOccurrence, Reminder)
        .join(Reminder, Reminder.id == ReminderOccurrence.reminder_id)
        .where(
            ReminderOccurrence.status == REMINDER_OCCURRENCE_STATUS_PENDING,
            ReminderOccurrence.due_at <= moment,
            ReminderOccurrence.due_at >= cutoff,
            ReminderOccurrence.notified_at.is_(None),
            Reminder.status == REMINDER_STATUS_ACTIVE,
            Reminder.deleted_at.is_(None),
        )
        .order_by(ReminderOccurrence.due_at.asc(), Reminder.id.asc())
    ).all()

    claimed: list[tuple[ReminderOccurrence, Reminder]] = []
    skipped = 0
    for occurrence, reminder in due_rows:
        result = db.execute(
            update(ReminderOccurrence)
            .where(
                ReminderOccurrence.id == occurrence.id,
                ReminderOccurrence.notified_at.is_(None),
            )
            .values(notified_at=moment)
            .execution_options(synchronize_session=False)
        )
        if int(getattr(result, "rowcount", 0) or 0) != 1:
            # 并发的另一轮扫描刚发过：这一轮不重复弹。
            skipped += 1
            continue
        claimed.append((occurrence, reminder))

    if not claimed:
        return {
            "enabled": True,
            "delivered": 0,
            "notification_ids": [],
            "merged": False,
            "skipped": skipped,
        }

    expires_at = moment + NOTIFICATION_TTL
    notification_ids: list[int] = []
    if len(claimed) == 1:
        occurrence, reminder = claimed[0]
        title, body, deep_link, dedupe_key = _reminder_notification(
            db,
            reminder,
            moment,
            due_at=occurrence.due_at,
            occurrence_id=occurrence.id,
            revision=occurrence.updated_at,
        )
        row = emit(
            db,
            type=NOTIFICATION_TYPE_REMINDER_DUE,
            severity=NOTIFICATION_SEVERITY_INFO,
            title=title,
            body=body,
            deep_link=deep_link,
            dedupe_key=dedupe_key,
            expires_at=expires_at,
        )
        notification_ids.append(int(row.id))
    else:
        # 开机补扫：20 条逾期逐条弹会淹没用户，合并成一条，点开去提醒列表。
        ids = sorted(int(occurrence.id) for occurrence, _reminder in claimed)
        row = emit(
            db,
            type=NOTIFICATION_TYPE_REMINDER_DUE,
            severity=NOTIFICATION_SEVERITY_INFO,
            title=f"提醒到期（{len(claimed)} 条）",
            body=f"你离开期间有 {len(claimed)} 条提醒到期，点开查看提醒列表。",
            deep_link="/tracker",
            dedupe_key=f"reminder_due:batch:{ids[0]}-{ids[-1]}:{moment.strftime('%Y%m%d%H%M')}",
            expires_at=expires_at,
        )
        notification_ids.append(int(row.id))
    db.commit()
    logger.info(
        "提醒到期投递通知 %s 条（合并=%s，reminder 命中 %s 条）",
        len(notification_ids),
        len(claimed) > 1,
        len(claimed),
    )
    return {
        "enabled": True,
        "delivered": len(claimed),
        "notification_ids": notification_ids,
        "merged": len(claimed) > 1,
        "skipped": skipped,
    }


def _reminder_notification(
    db: Session,
    reminder: Reminder,
    moment: datetime,
    *,
    due_at: datetime | None = None,
    occurrence_id: int | None = None,
    revision: datetime | None = None,
) -> tuple[str, str, str, str]:
    """组装单条到期通知：``(标题, 正文, 深链, 幂等键)``。

    正文只写"是什么 · 哪家公司/岗位 · 什么时候"，动作由前端按 ``deep_link`` 决定。
    """
    kind = _REMINDER_KIND_LABELS.get(reminder.kind, reminder.kind or "提醒")
    parts = [kind]
    target = _reminder_target_label(db, reminder)
    if target:
        parts.append(target)
    due = _as_naive_utc(due_at if due_at is not None else reminder.remind_at)
    parts.append(_due_phrase(due, moment))
    title = f"提醒：{reminder.title or '待办'}"[:200]
    # 幂等键 = "哪一次到期"。一次到期只发一条；推迟/改期会换掉这一行的 due_at 并清空
    # notified_at，于是"改到未来再改回过去"能再发一条——重复扫描不会重新投递。
    occurrence_key = occurrence_id if occurrence_id is not None else 0
    # 末尾带上 occurrence 的修订时刻：改期/推迟会 bump 它，于是"改到未来再改回过去"
    # 能再发一条（同一个 due 但不同修订）；重复扫描同一行则命中同一条通知。
    stamp = _as_naive_utc(revision or moment).isoformat()
    return (
        title,
        " · ".join(parts),
        f"/tracker?reminder={reminder.id}",
        f"reminder_due:{reminder.id}:{occurrence_key}:{due.isoformat()}:{stamp}",
    )


def _reminder_target_label(db: Session, reminder: Reminder) -> str:
    """「公司 · 岗位」；岗位优先于进度，读不到就空串（软删对象当作没有）。"""
    from ..models.job import Job
    from ..models.tracker import ApplicationTrack

    if reminder.job_id:
        job = db.get(Job, reminder.job_id)
        if job is not None and getattr(job, "deleted_at", None) is None:
            return " · ".join(part for part in (job.company, job.title) if part)
    if reminder.track_id:
        track = db.get(ApplicationTrack, reminder.track_id)
        if track is not None and getattr(track, "deleted_at", None) is None:
            return " · ".join(part for part in (track.company, track.title) if part)
    return ""


def _due_phrase(remind_at: datetime, moment: datetime) -> str:
    """「今天 / 逾期 N 天」——到期行的 ``remind_at`` 不会在未来。"""
    days = reminder_days_until(remind_at, moment)
    if days < 0:
        return f"逾期 {abs(days)} 天"
    if days == 0:
        return "今天"
    return f"{days} 天后"


__all__ = [
    "BACKFILL_WINDOW",
    "NOTIFICATION_TTL",
    "deliver_due_reminders",
]
