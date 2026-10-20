# SPDX-License-Identifier: Apache-2.0
"""助手消息持久化与 SSE 编码助手（从 assistant_stream.py 拆出，500 行预算守卫）。

职责单一：消息上下文写回、收尾落库、浏览器断开兜底、SSE 帧编码。流编排
（模型轮次、工具循环、事件下发）留在 ``assistant_stream.py``；两处共享的
会话工厂约定（RF-03：``factory`` 缺省回退全局 SessionLocal）也定义在这里。
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.assistant import ChatConversation, ChatMessage
from ..models.profile import utcnow
from ..schemas.assistant import ChatMessageOut


def format_sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def history_snapshot(db: Session, conversation_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.status == "complete",
        )
        .order_by(ChatMessage.id.desc())
        .limit(20)
        .all()
    )
    return [
        {"role": row.role, "content": row.content, "attachments": row.attachments or []}
        for row in reversed(rows)
        if row.role in {"user", "assistant"}
    ]


def update_message_context(
    message_id: int, context: dict[str, Any], *, factory: Any = None
) -> None:
    """整体替换一条消息的 context；``factory`` 缺省用全局会话（非流式调用方）。"""
    with (factory or SessionLocal)() as db:
        message = db.get(ChatMessage, message_id)
        if message is None:
            return
        message.context = context
        db.commit()


def finish_assistant_message(
    message_id: int,
    *,
    content: str,
    status: str,
    error: str = "",
    factory: Any = None,
    usage: dict[str, Any] | None = None,
) -> ChatMessageOut | None:
    """收尾落库。``usage`` 是本次回答的用量总口径（RF-14 §2.2-5，可选）：写进
    ``ChatMessage.context``（JSON 列，零迁移）。``context`` 是整体替换语义，
    所以这里**就地合并**到已存的 context 上再写回，绝不冲掉思考/工具记录。"""
    with (factory or SessionLocal)() as db:
        message = db.get(ChatMessage, message_id)
        if message is None:
            return None
        message.content = content
        message.status = status
        message.error = error
        if usage is not None:
            context = dict(message.context or {})
            context["usage"] = usage
            message.context = context
        conversation = db.get(ChatConversation, message.conversation_id)
        if conversation is not None:
            conversation.updated_at = utcnow()
        db.commit()
        db.refresh(message)
        return ChatMessageOut.model_validate(message)


def cancel_pending_assistant_message(
    message_id: int, content: str, *, factory: Any = None
) -> None:
    """Persist an interrupted stream without overwriting an existing terminal state."""
    with (factory or SessionLocal)() as db:
        message = db.get(ChatMessage, message_id)
        if message is None or message.status != "pending":
            return
        message.content = content
        message.status = "cancelled"
        message.error = "回复已中断"
        conversation = db.get(ChatConversation, message.conversation_id)
        if conversation is not None:
            conversation.updated_at = utcnow()
        db.commit()
