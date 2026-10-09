"""助手历史对话（放宽模式）的工具实现。

``chat_conversation`` / ``chat_message`` 默认不进助手的工具列表——对话是用户与
模型之间的私密记录。用户在设置里显式打开「助手放宽模式」后，这两个只读工具才
会下发，供助手回看"我们之前聊过什么"。此处同样不做二次脱敏：门控在下发处。

删除与管理（重命名/归档/分组）都不在工具范围：那些都在助手页的会话侧栏操作。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ....models.assistant import ChatConversation, ChatMessage
from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from .._types import ToolResult

_SURFACE_LABELS = {"page": "求职助手", "orb": "投投悬浮球"}

# 单条消息截断：历史回看是"找内容"，不是全文导出（导出在会话侧栏）。
_MAX_MESSAGE_CHARS = 2_000
_MAX_MESSAGES = 50


def _conversation_or_error(db: Session, conversation_id: int) -> ChatConversation:
    conversation = db.get(ChatConversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ValueError(f"对话 {conversation_id} 不存在")
    return conversation


def _tool_list_chat_conversations(db: Session, arguments: dict) -> ToolResult:
    """列出历史对话（标题/入口/更新时间，可按关键词搜标题）。"""
    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    query = db.query(ChatConversation).filter(ChatConversation.deleted_at.is_(None))
    keyword = str(arguments.get("keyword") or "").strip()
    if keyword:
        query = query.filter(ChatConversation.title.like(f"%{keyword}%"))
    total = query.count()
    rows = query.order_by(ChatConversation.updated_at.desc()).limit(limit).all()
    payload = {
        "总数": total,
        "返回": len(rows),
        "对话": [
            {
                "id": row.id,
                "标题": row.title,
                "入口": _SURFACE_LABELS.get(row.surface, row.surface),
                "置顶": row.pinned,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了 {len(rows)} 个历史对话",
        link="/assistant",
    )


def _tool_get_chat_conversation(db: Session, arguments: dict) -> ToolResult:
    """读取一场对话的完整消息（按时间正序，单条超长会截断）。"""
    conversation = _conversation_or_error(db, int(arguments["conversation_id"]))
    messages = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.status == "complete",
        )
        .order_by(ChatMessage.id.asc())
        .limit(_MAX_MESSAGES)
        .all()
    )
    payload = {
        "id": conversation.id,
        "标题": conversation.title,
        "入口": _SURFACE_LABELS.get(conversation.surface, conversation.surface),
        "消息": [
            {
                "role": row.role,
                "content": (row.content or "")[:_MAX_MESSAGE_CHARS],
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in messages
        ],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了对话「{conversation.title}」",
        link="/assistant",
    )
