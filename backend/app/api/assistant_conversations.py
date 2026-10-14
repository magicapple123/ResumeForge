"""求职助手会话的数据库读写。"""

import logging
from datetime import datetime
from pathlib import Path
from typing import get_args

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models.assistant import ChatConversation, ChatMessage
from ..models.profile import utcnow
from ..runtime.log_fields import safe_log_text
from ..schemas.assistant import (
    ChatConversationBrief,
    ChatConversationCreate,
    ChatConversationDetail,
    ChatConversationForkRequest,
    ChatConversationUpdate,
    ChatMessageOut,
    ConversationSurface,
)
from ..services import trash

logger = logging.getLogger(__name__)

DEFAULT_TITLE = "新对话"
WELCOME_TITLE = "开始使用求职助手"
_WELCOME_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "assistant_welcome.md"

_SURFACE_VALUES: tuple[ConversationSurface, ...] = get_args(ConversationSurface)


def _as_surface(value: str) -> ConversationSurface:
    """模型层 ``surface`` 是 ``str``，出口处收窄为 schema 的 ``Literal``。

    取值由会话创建 / 复制链路用 schema 校验过的值写入，正常不会走到兜底；万一库里
    出现未知值，在这里大声失败（与 pydantic Literal 字段的校验语义一致），不悄悄把
    非法值发给前端。
    """
    if value not in _SURFACE_VALUES:
        raise ValueError(f"未知的会话界面：{value!r}")
    return value


def welcome_message() -> str:
    """内置引导对话的正文。

    读文件而不是写死在代码里：引导内容会随功能变化，和系统提示一样应该可以单独
    修改、评审；文件缺失时退回一句最小说明，不让"没有引导"变成接口 500。
    """
    try:
        text = _WELCOME_PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        text = "你好，我是简历通的求职助手。可以在下方输入框直接提问，或先关联岗位、简历和资料。"
    # 时间感知：欢迎对话只创建一次，这里是"首次打开的当地时间"——深夜/凌晨创建时
    # 附一句休息提醒，让投投的开场也知道看时候（与主助手 _local_time_note 同口径）。
    now = datetime.now().astimezone()
    if now.hour >= 23 or now.hour < 5:
        return f"{text}\n\n对了——现在已经很晚了，忙完这一阵就早点休息。"
    return text


def conversation_or_404(
    db: Session, conversation_id: int, surface: ConversationSurface = "page"
) -> ChatConversation:
    conversation = (
        db.query(ChatConversation)
        .filter(ChatConversation.id == conversation_id, ChatConversation.surface == surface)
        .one_or_none()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="会话不存在或已被删除")
    return conversation


def _message_counts(db: Session, conversation_ids: list[int]) -> dict[int, int]:
    """一次查询取回所有会话的消息条数，避免每条会话各查一次。"""
    if not conversation_ids:
        return {}
    rows = (
        db.query(ChatMessage.conversation_id, func.count(ChatMessage.id))
        .filter(ChatMessage.conversation_id.in_(conversation_ids))
        .group_by(ChatMessage.conversation_id)
        .all()
    )
    return {conversation_id: count for conversation_id, count in rows}


def _to_brief(conversation: ChatConversation, message_count: int = 0) -> ChatConversationBrief:
    return ChatConversationBrief(
        id=conversation.id,
        title=conversation.title,
        surface=_as_surface(conversation.surface),
        pinned=conversation.pinned,
        favorite=conversation.favorite,
        archived=conversation.archived,
        group_name=conversation.group_name,
        message_count=message_count,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def create_conversation(payload: ChatConversationCreate, db: Session) -> ChatConversationBrief:
    title = " ".join(payload.title.split()) or DEFAULT_TITLE
    conversation = ChatConversation(title=title[:120], surface=payload.surface)
    db.add(conversation)
    db.flush()
    message_count = 0
    if payload.welcome:
        conversation.title = title[:120] if title != DEFAULT_TITLE else WELCOME_TITLE
        db.add(
            ChatMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=welcome_message(),
                status="complete",
            )
        )
        message_count = 1
    db.commit()
    db.refresh(conversation)
    return _to_brief(conversation, message_count)


def list_conversations(
    limit: int,
    db: Session,
    surface: ConversationSurface = "page",
    keyword: str = "",
) -> list[ChatConversationBrief]:
    """按置顶、更新时间排序返回会话（含已归档，由前端按筛选展示）。

    ``keyword``（P0-2）：按标题或**首条消息**正文模糊过滤。会话超过一屏之后
    "翻不到旧会话"的出路是搜索而不是无限拉全量——首条消息通常是用户的开场提问，
    命中它就能找回"那次问了什么"的对话。取"每会话 ``min(id)`` 的那条消息"而不是
    任意消息：只搜开场白，避免搜正文把会话列表变成全文检索（那是搜索页的职责）。
    """
    query = db.query(ChatConversation).filter(
        trash.live_only(ChatConversation), ChatConversation.surface == surface
    )
    term = keyword.strip()
    if term:
        like = f"%{term}%"
        first_message_ids = (
            db.query(func.min(ChatMessage.id).label("min_id"))
            .group_by(ChatMessage.conversation_id)
            .subquery()
        )
        matched_conversations = (
            db.query(ChatMessage.conversation_id)
            .join(first_message_ids, ChatMessage.id == first_message_ids.c.min_id)
            .filter(ChatMessage.content.like(like))
            .subquery()
        )
        query = query.filter(
            or_(
                ChatConversation.title.like(like),
                ChatConversation.id.in_(db.query(matched_conversations.c.conversation_id)),
            )
        )
    rows = (
        query.order_by(
            ChatConversation.pinned.desc(),
            ChatConversation.updated_at.desc(),
            ChatConversation.id.desc(),
        )
        .limit(limit)
        .all()
    )
    counts = _message_counts(db, [row.id for row in rows])
    return [_to_brief(row, counts.get(row.id, 0)) for row in rows]


def read_conversation(
    conversation_id: int,
    db: Session,
    surface: ConversationSurface = "page",
    message_limit: int = 0,
) -> ChatConversationDetail:
    """会话详情；``message_limit > 0`` 时只下发最新 N 条（B5 按需加载）。

    0 = 全量（完全兼容旧行为）。>0 时按 id 倒序取 N 条再正序返回，``messages_total``
    如实给全量条数、``has_earlier`` 标记是否还有更早的——更早的消息由
    ``read_earlier_messages`` 分页补齐，长对话不再一次性全量 selectinload。
    """
    conversation = (
        db.query(ChatConversation)
        .filter(trash.live_only(ChatConversation), ChatConversation.surface == surface)
        .filter(ChatConversation.id == conversation_id)
        .one_or_none()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="会话不存在或已被删除")
    message_query = db.query(ChatMessage).filter(ChatMessage.conversation_id == conversation_id)
    messages_total = message_query.count()
    if message_limit > 0:
        rows = message_query.order_by(ChatMessage.id.desc()).limit(message_limit).all()
        rows.reverse()
        has_earlier = messages_total > len(rows)
    else:
        rows = message_query.order_by(ChatMessage.id).all()
        has_earlier = False
    # 先验证 brief 再拼 detail：避免 model_validate 触发 conversation.messages 的
    # 全量懒加载——limit 模式下这正是要省掉的那次查询。
    brief = ChatConversationBrief.model_validate(conversation)
    return ChatConversationDetail(
        **brief.model_dump(),
        messages=[ChatMessageOut.model_validate(row) for row in rows],
        messages_total=messages_total,
        has_earlier=has_earlier,
    )


def read_earlier_messages(
    conversation_id: int,
    before_id: int,
    limit: int,
    db: Session,
    surface: ConversationSurface = "page",
) -> tuple[list[ChatMessageOut], bool]:
    """取 ``before_id`` 之前（更旧）的最新 ``limit`` 条消息，返回 (消息, 是否还有更早的)。

    surface 校验与 ``read_conversation`` 相同（404 语义一致）；倒序取再正序返回，
    界面直接 prepend 即可衔接。
    """
    conversation_or_404(db, conversation_id, surface)
    query = db.query(ChatMessage).filter(
        ChatMessage.conversation_id == conversation_id,
        ChatMessage.id < before_id,
    )
    remaining = query.count()
    rows = query.order_by(ChatMessage.id.desc()).limit(limit).all()
    rows.reverse()
    return [ChatMessageOut.model_validate(row) for row in rows], remaining > len(rows)


def update_conversation(
    conversation_id: int,
    payload: ChatConversationUpdate,
    db: Session,
    surface: ConversationSurface = "page",
) -> ChatConversationBrief:
    conversation = conversation_or_404(db, conversation_id, surface)
    if payload.title is not None:
        conversation.title = payload.title
    if payload.pinned is not None:
        conversation.pinned = payload.pinned
    if payload.favorite is not None:
        conversation.favorite = payload.favorite
    if payload.archived is not None:
        conversation.archived = payload.archived
        # 归档时顺手取消置顶：置顶的归档会话在侧栏顶部会显得很矛盾。
        if payload.archived:
            conversation.pinned = False
    if payload.group_name is not None:
        conversation.group_name = payload.group_name
    # 标记变化不改变会话的时间排序，取消置顶后仍回到原位置。
    if payload.title is not None:
        conversation.updated_at = utcnow()
    db.commit()
    db.refresh(conversation)
    count = _message_counts(db, [conversation.id]).get(conversation.id, 0)
    return _to_brief(conversation, count)


def fork_conversation(
    conversation_id: int,
    payload: ChatConversationForkRequest,
    db: Session,
    surface: ConversationSurface = "page",
) -> ChatConversationDetail:
    """「在新对话中继续」：把原会话最近若干条消息复制成一段新会话。

    只复制文本：附件（尤其是图片 data URL）原样搬运会让同一份大文件在库里存两份，
    所以只在正文后附上文件名的提示，需要时用户可以重新上传。
    """
    source = conversation_or_404(db, conversation_id, surface)
    rows = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.status == "complete",
            ChatMessage.role.in_(("user", "assistant")),
        )
        .order_by(ChatMessage.id.desc())
        .limit(payload.message_limit)
        .all()
    )
    title = " ".join(payload.title.split())[:120] or f"{source.title}（续）"[:120]
    conversation = ChatConversation(title=title, surface=source.surface)
    db.add(conversation)
    db.flush()
    for row in reversed(rows):
        content = row.content
        attachment_names = [
            str(item.get("name", "")).strip()
            for item in (row.attachments or [])
            if isinstance(item, dict) and str(item.get("name", "")).strip()
        ]
        if attachment_names:
            content = f"{content}\n\n（原对话附件：{'、'.join(attachment_names)}）".strip()
        db.add(
            ChatMessage(
                conversation_id=conversation.id,
                role=row.role,
                content=content,
                status="complete",
                model=row.model,
            )
        )
    db.commit()
    db.refresh(conversation)
    return read_conversation(conversation.id, db, _as_surface(source.surface))


def delete_conversation(
    conversation_id: int, db: Session, surface: ConversationSurface = "page"
) -> None:
    """移入回收站（软删除）。

    以前是 `db.delete(conversation)` —— 连带消息一起真删（`cascade="all, delete-orphan"`）。
    会话是用户和助手反复沟通出来的，误删一整段对话的代价太高，所以改成软删除；
    彻底删除（连同消息）在「回收站」里单独提供。

    已经在回收站里的会话**再删一次返回 404**（与其余五类内容一致）：不这么判的话，
    `soft_delete` 是幂等的，界面上会得到"删成功"的假象，而它其实早就删过了。
    """
    conversation = conversation_or_404(db, conversation_id, surface)
    if trash.is_deleted(conversation):
        raise HTTPException(status_code=404, detail="会话不存在或已被删除")
    trash.soft_delete(db, "conversation", conversation)
    db.commit()


def delete_messages(
    db: Session,
    conversation_id: int,
    message_ids: list[int],
    surface: ConversationSurface = "page",
) -> int:
    """删除会话里的若干条消息，返回实际删除的条数。

    引用关系要显式解除：`quoted_message_id` 没有外键（SQLite 不支持给已有表加外键列），
    所以这里先把指向被删消息的引用置空——否则界面上会出现指向不存在消息的引用块。
    引用消息的 `context.quoted` 快照保留，正文里的引用内容仍然可读。
    """
    conversation = conversation_or_404(db, conversation_id, surface)
    rows = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.id.in_(message_ids),
        )
        .all()
    )
    if not rows:
        return 0
    ids = [row.id for row in rows]
    db.query(ChatMessage).filter(ChatMessage.quoted_message_id.in_(ids)).update(
        {ChatMessage.quoted_message_id: None}, synchronize_session=False
    )
    for row in rows:
        db.delete(row)
    conversation.updated_at = utcnow()
    db.commit()
    logger.info("已删除消息 conversation_id=%s count=%s", safe_log_text(conversation_id), len(rows))
    return len(rows)


__all__ = [
    "DEFAULT_TITLE",
    "WELCOME_TITLE",
    "conversation_or_404",
    "create_conversation",
    "delete_messages",
    "fork_conversation",
    "list_conversations",
    "read_conversation",
    "read_earlier_messages",
    "update_conversation",
    "welcome_message",
]
