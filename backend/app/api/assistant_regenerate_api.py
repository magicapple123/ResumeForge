# SPDX-License-Identifier: Apache-2.0
"""「重新生成」助手回答（#13A）：只重跑最后一条回答，不插入新的用户消息。

为什么不复用 ``POST /conversations/{id}/messages``：那条端点会再插一条 user 消息，
历史里同一个问题会出现两遍。重新生成的语义是"同一个问题再答一次"：

- 只允许最后一条**助手回答**（历史回答重跑没有意义，也会打乱后面的上下文）；
- 旧回答标 ``status=superseded`` + ``context.superseded_by=新消息 id``；
- 会话消息列表与模型历史都过滤 ``superseded``，但 DB 行原样保留（可审计/可导出回看）。

挂载方式与 ``assistant_compaction_api`` 相同：提供 ``register_regenerate_routes(router)``，
由 ``api/assistant.py`` 在 ``/api/assistant`` router 建好后调用一次——路由注册表由别的线维护，
本模块不碰它。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.assistant import ChatMessage
from ..models.profile import utcnow
from ..schemas.assistant import AssistantMessageCreate, ConversationSurface
from ..services.assistant.assistant_persistence import history_snapshot
from ..services.assistant.assistant_system_prompt import _system_prompt
from ..services.llm import create_provider
from ..services.llm.usage_tasks import (
    DEFAULT_AUDIT_BUDGET,
    DEFAULT_AUDIT_LANGUAGE,
    set_ambient_scope,
)
from ..services.settings_service import get_llm_config, resolve_assistant_relaxed_mode
from ..services.ui_locale import get_ui_locale
from .assistant_context import load_local_context
from .assistant_conversations import SUPERSEDED_STATUS, conversation_or_404
from .assistant_stream import stream_message_events

logger = logging.getLogger(__name__)


class AssistantRegenerateRequest(BaseModel):
    """重新生成只需要"这一次怎么生成"的运行时参数；问题与上下文都从原消息里取。"""

    model_config = ConfigDict(extra="forbid")

    reasoning_effort: str = ""
    relaxed_mode: bool | None = None
    allow_write: bool = False


def _regenerable_pair(
    db: Session, conversation_id: int, message_id: int
) -> tuple[ChatMessage, ChatMessage]:
    """校验"可以重跑"，并取回 (旧回答, 它对应的用户问题)。"""
    target = db.get(ChatMessage, message_id)
    if target is None or target.conversation_id != conversation_id:
        raise HTTPException(status_code=404, detail="消息不存在或不在当前会话")
    if target.role != "assistant" or target.kind == "proposal_result":
        raise HTTPException(status_code=422, detail="只能重新生成助手的回答")
    if target.status == SUPERSEDED_STATUS:
        raise HTTPException(status_code=409, detail="这条回答已经被重新生成过")
    # 必须是时间线上最后一条对话消息：后面还有用户提问时重跑旧回答，会把新问题
    # 挤出上下文；proposal_result 是写入终态回写，不参与对话先后，不算"后面"。
    later = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.id > message_id,
            ChatMessage.status != SUPERSEDED_STATUS,
            ChatMessage.kind != "proposal_result",
        )
        .first()
    )
    if later is not None:
        raise HTTPException(status_code=409, detail="只能重新生成最后一条回答")
    user_message = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.role == "user",
            ChatMessage.id < message_id,
        )
        .order_by(ChatMessage.id.desc())
        .first()
    )
    if user_message is None:
        raise HTTPException(status_code=409, detail="这条回答前没有对应的问题，无法重新生成")
    return target, user_message


def _replay_payload(
    user_message: ChatMessage, request_payload: AssistantRegenerateRequest
) -> AssistantMessageCreate:
    """把原用户消息还原成一次发送请求：问题、附件上下文与引用都沿用当时的存档。"""
    context = user_message.context if isinstance(user_message.context, dict) else {}
    return AssistantMessageCreate(
        content=user_message.content,
        job_id=context.get("job_id"),
        resume_id=context.get("resume_id"),
        web_search=bool(context.get("web_search")),
        allow_write=request_payload.allow_write,
        relaxed_mode=request_payload.relaxed_mode,
        reasoning_effort=request_payload.reasoning_effort,
        quoted_message_id=user_message.quoted_message_id,
    )


def register_regenerate_routes(router: APIRouter) -> None:
    """把重新生成路由挂到已存在的 /api/assistant router 上。"""

    @router.post("/conversations/{conversation_id}/messages/{message_id}/regenerate")
    async def regenerate_message(
        conversation_id: int,
        message_id: int,
        # 请求体可省略：旧客户端/直接重试时按默认参数（沿用全局设置）重跑。
        payload: AssistantRegenerateRequest = Body(default=AssistantRegenerateRequest()),
        surface: ConversationSurface = Query(default="page"),
        db: Session = Depends(get_db),
    ):
        conversation = conversation_or_404(db, conversation_id, surface)
        target, user_message = _regenerable_pair(db, conversation_id, message_id)
        replay = _replay_payload(user_message, payload)
        relaxed_mode = resolve_assistant_relaxed_mode(db, payload.relaxed_mode)
        set_ambient_scope(
            input_scope="assistant_context",
            masked=not relaxed_mode,
            language=get_ui_locale(db) or DEFAULT_AUDIT_LANGUAGE,
            budget=DEFAULT_AUDIT_BUDGET,
        )
        try:
            context_blocks, context_metadata = load_local_context(db, replay, relaxed=relaxed_mode)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        config = get_llm_config(db)
        if not config.base_url or not config.model:
            raise HTTPException(status_code=400, detail="尚未配置大模型 API")
        # 历史只取原问题**之前**的消息：问题本身要作为"本轮输入"，不能再进历史一遍。
        history = history_snapshot(db, conversation_id, before_id=user_message.id)
        attachments = list(user_message.attachments or [])
        quoted_snapshot = (
            user_message.context.get("quoted") if isinstance(user_message.context, dict) else None
        )
        generated_title = conversation.title
        # 先把所有可能失败的准备做完（provider 创建、系统提示词），再动数据库：
        # 否则"旧回答已标 superseded、新消息没建出来"会留下一段点不开的历史。
        provider = create_provider(config.without_thinking())
        provider.request_overrides = {"reasoning_effort": payload.reasoning_effort}
        system_prompt = _system_prompt(
            db, relaxed=relaxed_mode, conversation_id=conversation_id, client_context=None
        )
        superseded_context = dict(target.context or {})
        new_message = ChatMessage(
            conversation_id=conversation_id,
            role="assistant",
            status="pending",
            model=config.model,
        )
        db.add(new_message)
        db.flush()
        superseded_context["superseded_by"] = new_message.id
        target.context = superseded_context
        target.status = SUPERSEDED_STATUS
        conversation.updated_at = utcnow()
        db.commit()
        db.refresh(new_message)
        new_message_id = new_message.id
        db.close()
        logger.info(
            "助手重新生成 conversation_id=%s old_message_id=%s new_message_id=%s",
            conversation_id,
            message_id,
            new_message_id,
        )
        return StreamingResponse(
            stream_message_events(
                payload=replay,
                attachments=attachments,
                provider=provider,
                history=history,
                context_blocks=context_blocks,
                context_metadata=context_metadata,
                user_message_id=user_message.id,
                assistant_message_id=new_message_id,
                generated_title=generated_title,
                system_prompt=system_prompt,
                quoted=quoted_snapshot,
                conversation_id=conversation_id,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


__all__ = ["AssistantRegenerateRequest", "register_regenerate_routes"]
