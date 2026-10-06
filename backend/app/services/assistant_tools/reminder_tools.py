"""日历提醒的状态更新工具（标记完成 / 忽略）。

只推进 ``status`` 三态（pending 待办 / done 已完成 / dismissed 已忽略，语义见
``models/reminder``），不改提醒时间、绑定与备注——那些在「求职进度 → 提醒」页编辑。
与其它域一致，删除不提供（软删在页面上做）。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...models.reminder import REMINDER_STATUSES
from ...schemas.reminder import ReminderUpdate
from ..reminder_service import reminder_or_none
from ..reminder_service import update_reminder as update_reminder_record
from ._types import ToolResult

_STATUS_LABELS = {
    "pending": "待办",
    "done": "已完成",
    "dismissed": "已忽略",
}


def _tool_update_reminder(db: Session, arguments: dict) -> ToolResult:
    try:
        reminder_id = int(arguments.get("reminder_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供提醒 id（可以先用 list_reminders 查）") from None
    reminder = reminder_or_none(db, reminder_id)
    if reminder is None:
        raise ValueError(f"提醒 {reminder_id} 不存在")
    status = str(arguments.get("status") or "").strip()
    if status not in REMINDER_STATUSES:
        raise ValueError("status 只能是 pending（待办）/ done（已完成）/ dismissed（已忽略）")
    updated = update_reminder_record(db, reminder, ReminderUpdate(status=status))
    return ToolResult(
        text=json.dumps(
            {"id": updated.id, "title": updated.title, "status": updated.status},
            ensure_ascii=False,
        ),
        summary=f"把提醒「{updated.title}」标记为{_STATUS_LABELS[updated.status]}",
        link="/tracker",
        changed=True,
    )


__all__ = [
    "_tool_update_reminder",
]
