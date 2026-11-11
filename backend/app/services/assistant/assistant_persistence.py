# SPDX-License-Identifier: Apache-2.0
"""助手消息持久化助手（从 ``api/assistant_stream.py`` / ``api/assistant_persistence.py`` 下沉）。

职责单一：消息上下文写回、收尾落库、浏览器断开兜底。流编排（模型轮次、工具循环、
事件下发）留在 ``api/assistant_stream.py`` 的薄壳之后、实现在 ``assistant_stream_events``；
两处共享的会话工厂约定（RF-03：``factory`` 缺省回退全局 SessionLocal）也定义在这里。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...database import SessionLocal
from ...models.assistant import ChatConversation, ChatMessage
from ...models.profile import utcnow
from ...schemas.assistant import ChatMessageOut
from .assistant_sse import format_sse as format_sse

# 历史消息的字符预算：条数上限（20 条）挡不住"每条都很长"的无界增长——
# 20 条 5 千字回答就是 10 万字上下文，单轮 prompt 会被历史吃掉大半。
# 超出预算时从最旧的消息开始丢（保留最近对话），且至少保留最后一条，
# 因为用户刚问的问题必须伴随最近一轮上下文才有意义。
MAX_HISTORY_MESSAGES = 20
MAX_HISTORY_CHARS = 12_000


def history_snapshot(
    db: Session, conversation_id: int, *, before_id: int | None = None
) -> list[dict[str, Any]]:
    """取最近一段已完成历史；``before_id`` 只取更旧的消息（"重新生成"用）。

    重新生成不插入新的用户消息，而是拿原用户消息再答一次——那条消息本身不能
    进历史（否则问题会出现两遍），所以调用方传 ``before_id=原用户消息 id``。
    被取代的旧回答（status=superseded）自动被 ``status == "complete"`` 挡掉，
    模型历史里不会出现两版答案。
    """
    query = db.query(ChatMessage).filter(
        ChatMessage.conversation_id == conversation_id,
        ChatMessage.status == "complete",
    )
    if before_id is not None:
        query = query.filter(ChatMessage.id < before_id)
    rows = query.order_by(ChatMessage.id.desc()).limit(MAX_HISTORY_MESSAGES).all()
    history = [
        {
            "id": row.id,
            "role": row.role,
            "content": row.content,
            "attachments": row.attachments or [],
        }
        for row in reversed(rows)
        if row.role in {"user", "assistant"}
    ]
    selected: list[dict[str, Any]] = []
    used_chars = 0
    for message in reversed(history):
        content_chars = len(str(message.get("content") or ""))
        if selected and used_chars + content_chars > MAX_HISTORY_CHARS:
            break  # 额度用尽：更旧的消息不再带；最近一条无论如何保留
        selected.append(message)
        used_chars += content_chars
    selected.reverse()
    return selected


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


def cancel_pending_assistant_message(message_id: int, content: str, *, factory: Any = None) -> None:
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


__all__ = [
    "MAX_HISTORY_CHARS",
    "MAX_HISTORY_MESSAGES",
    "cancel_pending_assistant_message",
    "finish_assistant_message",
    "format_sse",
    "history_snapshot",
    "update_message_context",
]
