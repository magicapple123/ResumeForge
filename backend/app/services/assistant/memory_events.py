# SPDX-License-Identifier: Apache-2.0
"""记忆变更事件的读写（F33）。与 `memory.py` 拆开的理由：那个文件已经 410 行、
贴着 500 行预算，再加"记录 + 查询 + 序列化"就会顶线；事件逻辑本身也很独立。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.assistant_memory_event import (
    MEMORY_EVENT_ACTIONS,
    AssistantMemoryEvent,
)


def record_event(
    db: Session,
    memory_id: int,
    action: str,
    *,
    before: str = "",
    after: str = "",
) -> AssistantMemoryEvent:
    """追加一条事件；**不 commit**（调用方与记忆写入在同一个事务里落盘）。"""
    safe_action = action if action in MEMORY_EVENT_ACTIONS else "update"
    event = AssistantMemoryEvent(
        memory_id=int(memory_id),
        action=safe_action,
        before=str(before or "")[:500],
        after=str(after or "")[:500],
    )
    db.add(event)
    return event


def list_events(db: Session, memory_id: int, *, limit: int = 50) -> list[AssistantMemoryEvent]:
    """按时间倒序；上限 50 足够"最近发生了什么"，不把整部历史塞进弹窗。"""
    return (
        db.query(AssistantMemoryEvent)
        .filter(AssistantMemoryEvent.memory_id == int(memory_id))
        .order_by(AssistantMemoryEvent.at.desc(), AssistantMemoryEvent.id.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )


__all__ = ["list_events", "record_event"]
