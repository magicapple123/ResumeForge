# SPDX-License-Identifier: Apache-2.0
"""提醒到期任务卡的来源上下文（CR-20）。

任务卡自己只存 ``reminder_id`` 与 ``occurrence_due_at``：卡上要显示的「类型 · 到期 ·
公司/岗位」在 reminder / job 两张表里。这个模块负责**批量**补齐——一条任务列表固定
两条查询（reminder / job），绝不逐卡查库。

软删口径：提醒进了回收站（或已被彻底删除）时，卡上不给跳转链接，此时
``deleted=True`` 且不带公司/岗位（点进去在求职进度里找不到它）。用
``trash.live_only`` 反查"还在的提醒"，差集就是已删除。

``due_at`` 取任务自己的 ``occurrence_due_at``（这一张卡对应**那一次**到期）而不是
提醒的最新 ``remind_at``：提醒改期后旧卡仍应显示它自己那次的时点。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.agent_task import AgentTask
from ..models.job import Job
from ..models.reminder import Reminder
from . import trash


@dataclass(frozen=True)
class ReminderCardContext:
    """一张提醒任务卡要展示的来源上下文（只读投影，不是 ORM 行）。"""

    id: int
    title: str
    kind: str
    due_at: datetime | None
    company: str
    job_title: str
    deleted: bool


def reminder_card_contexts(
    db: Session, tasks: Sequence[AgentTask]
) -> dict[int, ReminderCardContext]:
    """按任务批量补齐提醒上下文，返回 ``{task_id: context}``。

    没有 ``reminder_id`` 的卡（手动 / 助手 / 巡检）不进结果，调用方据此下发 ``null``。
    """
    reminder_ids = {task.reminder_id for task in tasks if task.reminder_id}
    if not reminder_ids:
        return {}

    reminders = {
        row.id: row
        for row in db.execute(
            select(Reminder).where(Reminder.id.in_(reminder_ids), trash.live_only(Reminder))
        ).scalars()
    }
    job_ids = {row.job_id for row in reminders.values() if row.job_id}
    jobs = (
        {
            row.id: row
            for row in db.execute(
                select(Job).where(Job.id.in_(job_ids), trash.live_only(Job))
            ).scalars()
        }
        if job_ids
        else {}
    )

    contexts: dict[int, ReminderCardContext] = {}
    for task in tasks:
        if not task.reminder_id:
            continue
        reminder = reminders.get(task.reminder_id)
        job = jobs.get(reminder.job_id) if reminder and reminder.job_id else None
        contexts[task.id] = ReminderCardContext(
            id=task.reminder_id,
            title=reminder.title if reminder else "",
            kind=reminder.kind if reminder else "",
            due_at=task.occurrence_due_at,
            company=job.company if job else "",
            job_title=job.title if job else "",
            # 不在 live 集合里 = 进回收站或已被彻底删除；两种都不给链接。
            deleted=reminder is None,
        )
    return contexts


__all__ = ["ReminderCardContext", "reminder_card_contexts"]
