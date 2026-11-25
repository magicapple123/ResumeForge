# SPDX-License-Identifier: Apache-2.0
"""日历提醒（R-12）的持久化与检索。

提醒不自己发明时机，只记录用户或流程明确给出的时点。三个绑定对象（漏斗/岗位/简历）
都走 ``SET NULL``：被删对象不连坐，提醒仍保留、只是失去关联。

CR-28 起"一条提醒"与"一次到期"分开（见 ``models/reminder.py``）：

- **列表与 ``upcoming`` 只返回"有未处理那一次"的 active 计划**，排序用那一次的 ``due_at``
  （子查询 ``open_due_subquery``）；没有待办的计划（单次做完、跳过且无下一次）不再出现。
- ``remind_at`` 是"当前待办那次"的投影，由 ``reminder_occurrences`` 维护；这里只读它做展示，
  不参与"有没有待办"的判定。
- 完成 / 跳过 / 稍后都落在 occurrence 上；``status`` 的旧二态写法（done/dismissed/pending）
  仍被接受，作为"这一次"的动作翻译（助手与旧前端还在用这套说法）。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from ..models.job import Job
from ..models.profile import utcnow
from ..models.reminder import (
    REMINDER_OCCURRENCE_STATUS_DONE,
    REMINDER_OCCURRENCE_STATUS_SKIPPED,
    REMINDER_STATUS_ACTIVE,
    REMINDER_STATUS_ARCHIVED,
    Reminder,
)
from ..models.resume import ResumeRecord
from ..models.tracker import ApplicationTrack
from ..schemas.reminder import (
    ReminderCreate,
    ReminderListItemOut,
    ReminderOut,
    ReminderUpcomingOut,
    ReminderUpdate,
    ReminderUrgency,
)
from . import trash
from .reminder_occurrences import (
    archive_reminder,
    as_naive_utc,
    ensure_open_occurrence,
    open_due_subquery,
    open_occurrence,
    settle_occurrence,
    snooze_occurrence,
    to_naive_utc,
)

logger = logging.getLogger(__name__)

MAX_REMINDER_LIST = 500

#: 旧二态入口 -> 计划状态。列表筛选收到旧值时按"归档"理解（旧 done/dismissed 的行已被
#: 迁移归档），助手工具的 status 白名单因此不用跟着改。
_LEGACY_STATUS_FILTERS = {"pending": REMINDER_STATUS_ACTIVE, "done": REMINDER_STATUS_ARCHIVED,
                          "dismissed": REMINDER_STATUS_ARCHIVED}

# ===== 首页紧急度（前后端共用一份取值）=====
# 四档同时是 `ReminderUpcomingOut.urgency` 的取值域：这里标成 `ReminderUrgency`，
# `reminder_urgency()` 的返回值才能直接赋给那个 Literal 字段（否则每个赋值点都要 cast）。
REMINDER_URGENCY_OVERDUE: ReminderUrgency = "overdue"
REMINDER_URGENCY_SOON: ReminderUrgency = "soon"
REMINDER_URGENCY_UPCOMING: ReminderUrgency = "upcoming"
REMINDER_URGENCY_LATER: ReminderUrgency = "later"
REMINDER_URGENCIES = (
    REMINDER_URGENCY_OVERDUE,
    REMINDER_URGENCY_SOON,
    REMINDER_URGENCY_UPCOMING,
    REMINDER_URGENCY_LATER,
)

# 排序优先级：逾期最靠前，其次 24 小时内，再是 3 天内，最后更远。
_URGENCY_RANK = {
    REMINDER_URGENCY_OVERDUE: 0,
    REMINDER_URGENCY_SOON: 1,
    REMINDER_URGENCY_UPCOMING: 2,
    REMINDER_URGENCY_LATER: 3,
}


def _naive_utc(value: datetime) -> datetime:
    """统一成无时区 UTC，避免带时区与无时区比较抛 TypeError。"""
    return as_naive_utc(value)


def reminder_days_until(remind_at: datetime, now: datetime) -> int:
    """结构化倒计时：负数=逾期天数，0=今天，1=明天，``N``=N 天后。

    这是"离开提醒时间还有多久"的**唯一口径**：后端只给这个整数（以及兼容用的中文
    ``due_label``），展示文案由前端按界面语言自己组合——把中文成品串下发给英文界面，
    就会出现"同一行里 Tag 是中文、其余都是英文"的割裂。

    口径必须与历史标签**逐字一致**（``reminder_urgency`` 的中文标签就是照它拼的）：

    - 逾期：``-max(1, (now - remind_at).days)``——刚过 2 小时也算"已逾期 1 天"，
      那个 ``max(1, …)`` 不能丢，否则不足一天会被显示成"今天"。
    - 未逾期：``max(0, (remind_at.date() - now.date()).days)``——按**日历日**差，
      所以"今天稍后"是 0 而不是按小时取整。
    """
    remind_at = _naive_utc(remind_at)
    now = _naive_utc(now)
    if remind_at < now:
        return -max(1, (now - remind_at).days)
    return max(0, (remind_at.date() - now.date()).days)


def _due_label(remind_at: datetime, now: datetime) -> str:
    """非逾期提醒的展示标签：今天 / 明天 / N 天后。"""
    days_until = reminder_days_until(remind_at, now)
    if days_until <= 0:
        return "今天"
    if days_until == 1:
        return "明天"
    return f"{days_until} 天后"


def reminder_urgency(remind_at: datetime, now: datetime) -> tuple[ReminderUrgency, str]:
    """计算紧急度与展示标签。**紧急度口径只在这里实现一处**。

    口径：overdue=``remind_at < now``；soon≤24h；upcoming≤3 天；later 更远。
    """
    remind_at = _naive_utc(remind_at)
    now = _naive_utc(now)
    delta = remind_at - now
    if delta < timedelta(0):
        # 天数不在这里再算一遍：``reminder_days_until`` 是唯一口径，取负即逾期天数。
        days = -reminder_days_until(remind_at, now)
        return REMINDER_URGENCY_OVERDUE, f"已逾期 {days} 天"
    label = _due_label(remind_at, now)
    if delta <= timedelta(hours=24):
        return REMINDER_URGENCY_SOON, label
    if delta <= timedelta(days=3):
        return REMINDER_URGENCY_UPCOMING, label
    return REMINDER_URGENCY_LATER, label


def _filter_status(value: str) -> str:
    """列表筛选的状态：空 = 只看启用中的；旧二态映射到新取值。"""
    cleaned = (value or "").strip()
    if not cleaned:
        return REMINDER_STATUS_ACTIVE
    return _LEGACY_STATUS_FILTERS.get(cleaned, cleaned)


def _pending_query(db: Session):
    """active 且"还有待办那一次"的计划（带 ``next_due_at`` 列，用于排序/计数）。"""
    sub = open_due_subquery()
    query = (
        db.query(Reminder)
        .join(sub, sub.c.reminder_id == Reminder.id)
        .filter(trash.live_only(Reminder), Reminder.status == REMINDER_STATUS_ACTIVE)
    )
    return query, sub


def reminder_urgency_counts(db: Session, now: datetime | None = None) -> dict[str, int]:
    """待办提醒按紧急度分档计数（含 ``total``）。

    口径**必须**走 :func:`reminder_urgency`——四档阈值只在那里有一份实现，看板再写
    一遍就会与首页的紧急度标签对不上。只统计"有未处理那一次"的 active 计划：做完的
    这一次、没有下一次的计划不再是"接下来要做什么"。用子查询的时刻单列查询，不为一个
    计数把正文一起读进内存。
    """
    moment = now or utcnow()
    sub = open_due_subquery()
    rows = (
        db.query(sub.c.next_due_at)
        .join(Reminder, Reminder.id == sub.c.reminder_id)
        .filter(trash.live_only(Reminder), Reminder.status == REMINDER_STATUS_ACTIVE)
        .all()
    )
    counts: dict[str, int] = {urgency: 0 for urgency in REMINDER_URGENCIES}
    for (due_at,) in rows:
        urgency, _label = reminder_urgency(due_at, moment)
        counts[urgency] = counts.get(urgency, 0) + 1
    counts["total"] = len(rows)
    return counts


def list_reminders(
    db: Session, *, kind: str = "", status: str = "", limit: int = 200
) -> list[Reminder]:
    """按类型/状态过滤；只取未软删除的行。默认只看启用中的计划，按下一次到期升序。"""
    clause = _filter_status(status)
    if clause == REMINDER_STATUS_ACTIVE:
        # 有待办才排得上"接下来要做什么"：join 子查询，排序键就是那一刻。
        query, sub = _pending_query(db)
    else:
        query = db.query(Reminder).filter(
            trash.live_only(Reminder), Reminder.status == clause
        )
        sub = None
    if kind.strip():
        query = query.filter(Reminder.kind == kind.strip())
    if sub is not None:
        query = query.order_by(sub.c.next_due_at.asc(), Reminder.id.asc())
    else:
        query = query.order_by(Reminder.remind_at.asc(), Reminder.id.asc())
    return query.limit(max(1, min(limit, MAX_REMINDER_LIST))).all()


def upcoming_reminders(db: Session, *, limit: int = 50) -> list[Reminder]:
    """待办提醒：只返回"有未处理那一次"的 active 计划，按那一次的时刻升序。"""
    query, sub = _pending_query(db)
    return (
        query.order_by(sub.c.next_due_at.asc(), Reminder.id.asc())
        .limit(max(1, min(limit, MAX_REMINDER_LIST)))
        .all()
    )


def upcoming_reminder_out(reminder: Reminder, now: datetime) -> ReminderUpcomingOut:
    """把一条待办提醒转成首页回显结构，补上紧急度、结构化倒计时与兼容标签。"""
    out = ReminderUpcomingOut.model_validate(reminder)
    out.urgency, out.due_label = reminder_urgency(reminder.remind_at, now)
    out.days_until = reminder_days_until(reminder.remind_at, now)
    return out


def reminder_list_item_out(reminder: Reminder, now: datetime) -> ReminderListItemOut:
    """把一条提醒转成列表回显结构（补紧急度与结构化倒计时）。

    口径**只走** :func:`reminder_urgency` / :func:`reminder_days_until`（两处已有唯一实现），
    不在这里重算天数——列表与首页「近期提醒」卡的「已逾期 N 天」必须逐字一致。

    两个派生字段在 ``ReminderListItemOut`` 里是必填的：先由 ``ReminderOut`` 校验 ORM 行，
    再显式补上派生值。直接 ``model_validate(reminder)`` 会因 ORM 上没有这两个属性而失败。
    """
    base = ReminderOut.model_validate(reminder).model_dump()
    urgency, _label = reminder_urgency(reminder.remind_at, now)
    return ReminderListItemOut(
        **base,
        urgency=urgency,
        days_until=reminder_days_until(reminder.remind_at, now),
    )


def reminder_list_items_out(
    db: Session, *, kind: str = "", status: str = "", limit: int = 200, now: datetime | None = None
) -> list[ReminderListItemOut]:
    """列表接口的完整回显：在 ``list_reminders`` 的筛选/排序之上补两个派生字段。"""
    rows = list_reminders(db, kind=kind, status=status, limit=limit)
    moment = now or utcnow()
    return [reminder_list_item_out(row, moment) for row in rows]


def upcoming_reminders_out(db: Session, *, limit: int = 50) -> list[ReminderUpcomingOut]:
    """待办提醒的首页回显：只返回 pending，按紧急度+时间升序。"""
    rows = upcoming_reminders(db, limit=limit)
    now = utcnow()
    items = [upcoming_reminder_out(row, now) for row in rows]
    items.sort(key=lambda item: (_URGENCY_RANK[item.urgency], item.remind_at, item.id))
    return items


def reminder_or_none(db: Session, reminder_id: int) -> Reminder | None:
    """取一条提醒；已在回收站里的当作不存在。"""
    return trash.get_live(db, Reminder, reminder_id)


def _resolve_bindings(db: Session, values: dict) -> dict:
    """校验三个绑定对象：不存在或已软删则置空（SET NULL 语义）。"""
    if (
        values.get("track_id") is not None
        and trash.get_live(db, ApplicationTrack, values["track_id"]) is None
    ):
        values["track_id"] = None
    if values.get("job_id") is not None and trash.get_live(db, Job, values["job_id"]) is None:
        values["job_id"] = None
    if (
        values.get("resume_id") is not None
        and trash.get_live(db, ResumeRecord, values["resume_id"]) is None
    ):
        values["resume_id"] = None
    return values


def create_reminder(db: Session, payload: ReminderCreate) -> Reminder:
    """新增一条提醒，并落下「第一次到期」（``remind_at`` 先过 :func:`to_naive_utc`）。"""
    values = _resolve_bindings(db, payload.model_dump())
    values["remind_at"] = to_naive_utc(values["remind_at"])
    if values.get("recurrence_until") is not None:
        values["recurrence_until"] = to_naive_utc(values["recurrence_until"])
    reminder = Reminder(**values)
    db.add(reminder)
    # 第一条 occurrence 由模型事件在 insert 时落库（见 ``models/reminder.py``），
    # 这里只提交；不要在这里再补一次，否则两条路径会各自维护同一不变量。
    db.commit()
    db.refresh(reminder)
    logger.info("已新增提醒 id=%s kind=%s recurrence=%s", reminder.id, reminder.kind, reminder.recurrence)
    return reminder


def update_reminder(db: Session, reminder: Reminder, payload: ReminderUpdate) -> Reminder:
    """PATCH：只覆盖显式给出的字段，绑定对象同样做 SET NULL 校验。

    ``status`` 有三套写法，都翻译成对"这一次"或"这条计划"的操作：

    - ``done`` / ``dismissed``：把当前待办那次置 done / skipped（旧二态别名）；
    - ``active`` / ``pending``：恢复计划并补一条待办；
    - ``archived``：归档计划（不再出现在列表/首页）。

    改 ``remind_at`` = 改期：直接把当前待办那次的 ``due_at`` 移到新时刻并清掉投递标记
    （改到未来再改回过去能重新提醒）。CR-26：计划归档时回收它生成的未终态任务卡。
    """
    values = _resolve_bindings(db, payload.model_dump(exclude_unset=True))
    raw_status = values.pop("status", None)
    if values.get("remind_at") is not None:
        values["remind_at"] = to_naive_utc(values["remind_at"])
    if values.get("recurrence_until") is not None:
        values["recurrence_until"] = to_naive_utc(values["recurrence_until"])

    occurrence = open_occurrence(db, reminder.id)
    rescheduled = values.get("remind_at") is not None and (
        occurrence is None or _naive_utc(occurrence.due_at) != values["remind_at"]
    )
    for field, value in values.items():
        setattr(reminder, field, value)

    if rescheduled:
        target = occurrence or ensure_open_occurrence(db, reminder, due_at=reminder.remind_at)
        target.due_at = reminder.remind_at
        target.notified_at = None
        # 用户主动改期不是"稍后"，原来的推迟来源不再有意义。
        target.snoozed_from = None

    if raw_status in ("done", "dismissed"):
        settled = settle_occurrence(
            db,
            reminder,
            status=(
                REMINDER_OCCURRENCE_STATUS_DONE
                if raw_status == "done"
                else REMINDER_OCCURRENCE_STATUS_SKIPPED
            ),
        )
        # 只回收**这一次**生成的任务卡：重复计划的下一次还没建卡，不能被连坐。
        _cancel_tasks_for_reminder(
            db, reminder.id, raw_status, due_at=settled.get("due_at")
        )
    elif raw_status in ("active", "pending"):
        archive_reminder(db, reminder, archived=False)
    elif raw_status == REMINDER_STATUS_ARCHIVED:
        if archive_reminder(db, reminder, archived=True):
            _cancel_tasks_for_reminder(db, reminder.id, REMINDER_STATUS_ARCHIVED)
    db.commit()
    db.refresh(reminder)
    return reminder


def snooze_reminder(
    db: Session,
    reminder: Reminder,
    *,
    preset: str = "",
    until: datetime | None = None,
    now: datetime | None = None,
) -> Reminder:
    """把当前待办那次推到未来（1 小时 / 今晚 20:00 / 明早 9:00 / 自定义）。"""
    if reminder.status != REMINDER_STATUS_ACTIVE:
        # 归档的计划不能"稍后"：先恢复再推迟，否则提醒永远不会再出现。
        archive_reminder(db, reminder, archived=False)
    snooze_occurrence(db, reminder, preset=preset, until=until, now=now)
    db.commit()
    db.refresh(reminder)
    return reminder


def _cancel_tasks_for_reminder(
    db: Session, reminder_id: int, status: str, *, due_at: datetime | None = None
) -> int:
    """把该提醒下**未终态**的任务卡置 ``cancelled``，返回受影响任务数。

    取消原因写既有 ``AgentTask.error``（不再造迁移）。未完成步骤一并置 ``skipped``，
    与 ``agent_task_transitions.cancel`` 的终态形状保持一致——否则卡片已取消、步骤却还
    显示"待确认"。
    """
    from ..models.agent_task import (
        AGENT_TASK_ACTIVE_STATUSES,
        AGENT_TASK_STATUS_CANCELLED,
        AGENT_TASK_STEP_STATUS_DONE,
        AGENT_TASK_STEP_STATUS_FAILED,
        AGENT_TASK_STEP_STATUS_SKIPPED,
        AgentTask,
        AgentTaskStep,
    )

    conditions = [
        AgentTask.reminder_id == reminder_id,
        AgentTask.status.in_(AGENT_TASK_ACTIVE_STATUSES),
    ]
    if due_at is not None:
        # 只清算这一次；没写 occurrence_due_at 的旧卡不在这里被误伤。
        conditions.append(AgentTask.occurrence_due_at == due_at)
    task_ids = [
        int(task_id)
        for (task_id,) in db.query(AgentTask.id).filter(*conditions).all()
    ]
    if not task_ids:
        return 0
    moment = utcnow()
    reason = {
        REMINDER_OCCURRENCE_STATUS_DONE: "关联提醒已完成，任务卡自动结束",
        REMINDER_OCCURRENCE_STATUS_SKIPPED: "关联提醒已忽略，任务卡自动结束",
        "done": "关联提醒已完成，任务卡自动结束",
        "dismissed": "关联提醒已忽略，任务卡自动结束",
    }.get(status, "关联提醒已归档，任务卡自动结束")
    db.execute(
        update(AgentTaskStep)
        .where(
            AgentTaskStep.task_id.in_(task_ids),
            AgentTaskStep.status.notin_(
                (
                    AGENT_TASK_STEP_STATUS_DONE,
                    AGENT_TASK_STEP_STATUS_FAILED,
                    AGENT_TASK_STEP_STATUS_SKIPPED,
                )
            ),
        )
        .values(status=AGENT_TASK_STEP_STATUS_SKIPPED, finished_at=moment)
        .execution_options(synchronize_session=False)
    )
    db.query(AgentTask).filter(AgentTask.id.in_(task_ids)).update(
        {
            AgentTask.status: AGENT_TASK_STATUS_CANCELLED,
            AgentTask.error: reason,
            AgentTask.finished_at: moment,
            AgentTask.updated_at: moment,
        },
        synchronize_session=False,
    )
    logger.info("提醒 %s 进入终态，回收任务卡 %s 张", reminder_id, len(task_ids))
    return len(task_ids)


def delete_reminder(db: Session, reminder_id: int) -> bool:
    """移入回收站（软删除）；彻底删除在「回收站」里单独提供。"""
    reminder = db.get(Reminder, reminder_id)
    if reminder is None or trash.is_deleted(reminder):
        return False
    trash.soft_delete(db, "reminder", reminder)
    db.commit()
    return True


__all__ = [
    "MAX_REMINDER_LIST",
    "REMINDER_URGENCIES",
    "REMINDER_URGENCY_LATER",
    "REMINDER_URGENCY_OVERDUE",
    "REMINDER_URGENCY_SOON",
    "REMINDER_URGENCY_UPCOMING",
    "create_reminder",
    "delete_reminder",
    "list_reminders",
    "reminder_or_none",
    "reminder_days_until",
    "reminder_list_item_out",
    "reminder_list_items_out",
    "reminder_urgency",
    "reminder_urgency_counts",
    "snooze_reminder",
    "to_naive_utc",
    "upcoming_reminder_out",
    "upcoming_reminders",
    "upcoming_reminders_out",
    "update_reminder",
]
