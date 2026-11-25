# SPDX-License-Identifier: Apache-2.0
"""提醒的「这一次」：occurrence 的生成、完成/跳过、稍后提醒与逾期过期（CR-28）。

数据形状（见 ``models/reminder.py``）：``Reminder`` 是计划，``ReminderOccurrence`` 是一次到期。
本模块是 occurrence 的**唯一写入者**，也包括 ``Reminder.remind_at`` 这条投影的同步：

- 生成：``ensure_open_occurrence`` 保证"active 的计划总有一个待办 occurrence"；
- 完成/跳过：``settle_occurrence`` 把这一次置终态，并按 ``recurrence`` 生成下一次
  （done 且没有下一次 → 归档；skipped 从不让计划结束）；
- 稍后：``snooze_occurrence`` 把 ``due_at`` 推到未来，``snoozed_from`` 记住原始时刻
  （只在第一次推迟时写入，之后保持最早的那个）；
- 过期：``expire_stale_occurrences`` 把 ``due_at + 7 天`` 仍未处理的这一次自动置 skipped，
  并发一条「已过期」通知；重复规则下同样生成下一次。

时间口径与全库一致：**naive UTC**。稍后预设（今晚 20:00 / 明早 9:00）按**本机时区**的
墙钟解释，再经 :func:`to_naive_utc` 归一——用户说"今晚 8 点"指的是他自己的 8 点。
"""

from __future__ import annotations

import calendar
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models.notification import (
    NOTIFICATION_SEVERITY_WARNING,
    NOTIFICATION_TYPE_REMINDER_DUE,
)
from ..models.profile import utcnow
from ..models.reminder import (
    REMINDER_OCCURRENCE_STATUS_DONE,
    REMINDER_OCCURRENCE_STATUS_PENDING,
    REMINDER_OCCURRENCE_STATUS_SKIPPED,
    REMINDER_RECURRENCE_DAILY,
    REMINDER_RECURRENCE_MONTHLY,
    REMINDER_RECURRENCE_NONE,
    REMINDER_RECURRENCE_WEEKLY,
    REMINDER_STATUS_ACTIVE,
    REMINDER_STATUS_ARCHIVED,
    Reminder,
    ReminderOccurrence,
)
from ..vocabulary.reminder import (
    REMINDER_SNOOZE_ONE_HOUR,
    REMINDER_SNOOZE_PRESETS,
    REMINDER_SNOOZE_TOMORROW_MORNING,
    REMINDER_SNOOZE_TONIGHT,
    REMINDER_TOMORROW_HOUR,
    REMINDER_TONIGHT_HOUR,
)

logger = logging.getLogger(__name__)

#: 一条待办过了这么久还没被处理 = 视为放弃这一次（任务书 CR-28 第 5 条）。
EXPIRE_AFTER = timedelta(days=7)
#: 「稍后 1 小时」的偏移。
SNOOZE_ONE_HOUR = timedelta(hours=1)
#: 单条通知 / 一次扫描的批量上限：避免一次体检把历史全刷掉。
_MAX_EXPIRE_PER_SWEEP = 200


def to_naive_utc(value: datetime) -> datetime:
    """写入层唯一归一：裸 datetime 按**本机时区**解释，aware 先转 UTC 再去 tzinfo。

    全库口径是 naive UTC（SQLite 的 ``DateTime`` 会静默丢掉 tzinfo）；而助手/工具给的是
    用户本地时间的裸串——``2026-11-26T10:00:00`` 若原样落库，就会在 UTC+8 环境下晚 8 小时
    才提醒。裸值走 ``.astimezone(UTC)``（Python 按本机时区解释），正好对上"模型看到的是
    用户本地时间"这一事实；前端 ``toISOString()`` 给的是带 ``Z`` 的 aware 值，数值不变。

    历史数据不迁移：无法区分老行是前端写的 UTC 还是助手写的本地墙钟，批量改会毁掉正确数据。
    """
    return value.astimezone(UTC).replace(tzinfo=None)


def as_naive_utc(value: datetime) -> datetime:
    """统一成无时区 UTC，避免带时区与无时区比较抛 TypeError。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _add_month(moment: datetime) -> datetime:
    """按月 +1，日期溢出时收敛到当月最后一天（1 月 31 日 → 2 月 28/29 日）。"""
    year = moment.year + (1 if moment.month == 12 else 0)
    month = 1 if moment.month == 12 else moment.month + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def next_due_at(reminder: Reminder, due_at: datetime) -> datetime | None:
    """按重复规则算下一次；``none`` 或已越过 ``recurrence_until`` 返回 None。"""
    rule = (reminder.recurrence or REMINDER_RECURRENCE_NONE).strip()
    due_at = as_naive_utc(due_at)
    if rule == REMINDER_RECURRENCE_DAILY:
        candidate = due_at + timedelta(days=1)
    elif rule == REMINDER_RECURRENCE_WEEKLY:
        candidate = due_at + timedelta(days=7)
    elif rule == REMINDER_RECURRENCE_MONTHLY:
        candidate = _add_month(due_at)
    else:
        return None
    until = reminder.recurrence_until
    if until is not None and candidate > as_naive_utc(until):
        return None
    return candidate


def open_occurrence(db: Session, reminder_id: int) -> ReminderOccurrence | None:
    """这条提醒当前待办的那一次（最早的那条 pending）；没有则 None。"""
    return db.scalars(
        select(ReminderOccurrence)
        .where(
            ReminderOccurrence.reminder_id == reminder_id,
            ReminderOccurrence.status == REMINDER_OCCURRENCE_STATUS_PENDING,
        )
        .order_by(ReminderOccurrence.due_at.asc(), ReminderOccurrence.id.asc())
        .limit(1)
    ).first()


def open_due_subquery():
    """``(reminder_id, next_due_at)``：每条提醒最早的待办时刻，供列表/计数 join。

    用子查询而不是要求调用方逐个查 occurrence：一次列表只多一个 join，不会退化成
    N+1；这也是"只出现在有未处理那一次"的唯一判据。
    """
    return (
        select(
            ReminderOccurrence.reminder_id.label("reminder_id"),
            func.min(ReminderOccurrence.due_at).label("next_due_at"),
        )
        .where(ReminderOccurrence.status == REMINDER_OCCURRENCE_STATUS_PENDING)
        .group_by(ReminderOccurrence.reminder_id)
        .subquery()
    )


def ensure_open_occurrence(
    db: Session, reminder: Reminder, *, due_at: datetime | None = None
) -> ReminderOccurrence:
    """保证有计划待办的那一次；已有就复用（不重复生成）。"""
    existing = open_occurrence(db, reminder.id)
    if existing is not None:
        return existing
    # 调用方传进来的已经是归一后的 naive UTC（create/update 都先过 to_naive_utc），
    # 这里只做去时区，不能再按本机时区换算一次。
    moment = as_naive_utc(reminder.remind_at if due_at is None else due_at)
    occurrence = ReminderOccurrence(reminder_id=reminder.id, due_at=moment)
    db.add(occurrence)
    db.flush()
    sync_projection(db, reminder)
    return occurrence


def sync_projection(db: Session, reminder: Reminder) -> None:
    """把 ``remind_at`` 同步成"当前待办那次"的时刻（本模块是唯一写入者）。

    没有待办时**保持最后一次的时刻**：归档行仍要能显示"上一次是什么时候"，而"有没有
    待办"由 occurrence 的存在与否判定，不靠把这一列置空（列非空，历史行也都有值）。
    """
    next_due = db.scalar(
        select(func.min(ReminderOccurrence.due_at)).where(
            ReminderOccurrence.reminder_id == reminder.id,
            ReminderOccurrence.status == REMINDER_OCCURRENCE_STATUS_PENDING,
        )
    )
    if next_due is not None:
        reminder.remind_at = as_naive_utc(next_due)


def settle_occurrence(
    db: Session, reminder: Reminder, *, status: str, moment: datetime | None = None
) -> dict[str, Any]:
    """把当前待办那次置 done/skipped，并按规则生成下一次。

    返回 ``{"occurrence_id", "due_at", "status", "next_due_at", "archived"}``；没有待办时
    ``occurrence_id`` 为 None（幂等：重复点完成不会报错、也不会再生成下一次）。
    ``due_at`` 回传被结算那一次的原时刻，调用方按它精确回收这一轮生成的任务卡。
    """
    occurrence = open_occurrence(db, reminder.id)
    if occurrence is None:
        return {
            "occurrence_id": None,
            "due_at": None,
            "status": status,
            "next_due_at": None,
            "archived": False,
        }
    moment = as_naive_utc(moment or utcnow())
    occurrence.status = status
    occurrence.updated_at = moment
    next_due = next_due_at(reminder, occurrence.due_at)
    # skipped 同样生成下一次（跳过这一次不等于取消计划）。
    if next_due is not None and reminder.status == REMINDER_STATUS_ACTIVE:
        db.add(ReminderOccurrence(reminder_id=reminder.id, due_at=next_due))
    elif next_due is None and status == REMINDER_OCCURRENCE_STATUS_DONE:
        # 单次或已到结束条件：这一次做完，计划自然结束。
        reminder.status = REMINDER_STATUS_ARCHIVED
    db.flush()
    sync_projection(db, reminder)
    return {
        "occurrence_id": occurrence.id,
        "due_at": as_naive_utc(occurrence.due_at),
        "status": status,
        "next_due_at": next_due,
        "archived": reminder.status == REMINDER_STATUS_ARCHIVED,
    }


def archive_reminder(db: Session, reminder: Reminder, *, archived: bool) -> bool:
    """归档 / 恢复一条计划。返回是否发生了变化（供调用方决定要不要回收任务卡）。

    恢复时补一条待办：否则"恢复"后列表里看不到它，用户会以为没生效。补的时刻沿用
    投影列（上一次的到期时刻），过期体检会把太旧的自动跳过，不会立刻轰炸。
    """
    target = REMINDER_STATUS_ARCHIVED if archived else REMINDER_STATUS_ACTIVE
    if reminder.status == target:
        return False
    reminder.status = target
    if not archived:
        ensure_open_occurrence(db, reminder)
    db.flush()
    return True


def resolve_snooze_until(
    preset: str, *, now: datetime | None = None, until: datetime | None = None
) -> datetime:
    """把稍后预设解析成绝对时刻（naive UTC）。

    - ``one_hour``：现在 + 1 小时；
    - ``tonight``：本机今天 20:00（已经过了 20:00 就顺延到明天 20:00，不把时间往回拨）；
    - ``tomorrow_morning``：本机明天 09:00；
    - 自定义 ``until``：裸值按本机时区解释（与全库写入口径一致）。
    """
    if until is not None:
        return to_naive_utc(until)
    # ``now`` 可能是 aware（真实时钟/注入的 UTC），也可能是裸墙钟——两种都归到本机时区，
    # 因为"今晚 20:00"说的就是用户此刻所在时区的 20:00。
    local_now = (now or datetime.now()).astimezone()
    if preset == REMINDER_SNOOZE_ONE_HOUR:
        moment = local_now + SNOOZE_ONE_HOUR
    elif preset == REMINDER_SNOOZE_TONIGHT:
        moment = local_now.replace(hour=REMINDER_TONIGHT_HOUR, minute=0, second=0, microsecond=0)
        if moment <= local_now:
            moment += timedelta(days=1)
    elif preset == REMINDER_SNOOZE_TOMORROW_MORNING:
        moment = (local_now + timedelta(days=1)).replace(
            hour=REMINDER_TOMORROW_HOUR, minute=0, second=0, microsecond=0
        )
    else:
        raise ValueError(f"未知的稍后预设 {preset!r}，可选值：{'、'.join(REMINDER_SNOOZE_PRESETS)}")
    return to_naive_utc(moment)


def snooze_occurrence(
    db: Session,
    reminder: Reminder,
    *,
    preset: str = "",
    until: datetime | None = None,
    now: datetime | None = None,
) -> ReminderOccurrence:
    """把当前待办那次推到未来，``snoozed_from`` 保留最早的原始时刻。

    推迟不生成新的 occurrence：用户处理的是"这一次"，只是时间变了；因此也不会重置
    ``notified_at`` 之外的东西——重新武装靠 ``notified_at = NULL``（推到未来后到点还要再提醒）。
    """
    occurrence = ensure_open_occurrence(db, reminder)
    target = resolve_snooze_until(preset, now=now, until=until)
    if occurrence.snoozed_from is None:
        occurrence.snoozed_from = occurrence.due_at
    occurrence.due_at = target
    occurrence.notified_at = None
    occurrence.updated_at = as_naive_utc(now or utcnow())
    db.flush()
    sync_projection(db, reminder)
    return occurrence


def expire_stale_occurrences(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """逾期 7 天仍未处理 → 自动 skipped，并留一条「已过期」通知。

    - 重复规则下同样生成下一次（这一次过期不代表计划结束）；
    - 已被软删的提醒只把 occurrence 收尾，不发通知（用户已经不要它了）；
    - 通知 ``dedupe_key`` 用 occurrence id：同一次过期只提醒一次，重复扫描不叠加。
    """
    from .notifications import emit

    moment = as_naive_utc(now or utcnow())
    threshold = moment - EXPIRE_AFTER
    rows = db.scalars(
        select(ReminderOccurrence)
        .where(
            ReminderOccurrence.status == REMINDER_OCCURRENCE_STATUS_PENDING,
            ReminderOccurrence.due_at <= threshold,
        )
        .order_by(ReminderOccurrence.due_at.asc(), ReminderOccurrence.id.asc())
        .limit(_MAX_EXPIRE_PER_SWEEP)
    ).all()
    expired = 0
    notification_ids: list[int] = []
    for occurrence in rows:
        reminder = db.get(Reminder, occurrence.reminder_id)
        occurrence.status = REMINDER_OCCURRENCE_STATUS_SKIPPED
        occurrence.updated_at = moment
        expired += 1
        if reminder is None:
            continue
        if reminder.deleted_at is None:
            row = emit(
                db,
                type=NOTIFICATION_TYPE_REMINDER_DUE,
                severity=NOTIFICATION_SEVERITY_WARNING,
                title=f"提醒已过期：{reminder.title or '待办'}"[:200],
                body="这条提醒逾期 7 天未处理，已自动跳过。",
                deep_link=f"/tracker?reminder={reminder.id}",
                dedupe_key=f"reminder_expired:{occurrence.id}",
            )
            notification_ids.append(int(row.id))
        if reminder.status == REMINDER_STATUS_ACTIVE:
            next_due = next_due_at(reminder, occurrence.due_at)
            if next_due is not None:
                db.add(ReminderOccurrence(reminder_id=reminder.id, due_at=next_due))
        sync_projection(db, reminder)
    if expired:
        db.commit()
        logger.info("提醒过期体检：%s 条自动跳过（%s 条通知）", expired, len(notification_ids))
    return {"expired": expired, "notification_ids": notification_ids}


__all__ = [
    "EXPIRE_AFTER",
    "SNOOZE_ONE_HOUR",
    "archive_reminder",
    "as_naive_utc",
    "ensure_open_occurrence",
    "expire_stale_occurrences",
    "next_due_at",
    "open_due_subquery",
    "open_occurrence",
    "resolve_snooze_until",
    "settle_occurrence",
    "snooze_occurrence",
    "sync_projection",
    "to_naive_utc",
]
