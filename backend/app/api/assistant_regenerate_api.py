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
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.assistant import ChatMessage
from ..models.profile import utcnow
from ..runtime.blocking import run_sync
from ..schemas.assistant import AssistantMessageCreate, ConversationSurface
from ..services.assistant.assistant_conversations import (
    SUPERSEDED_STATUS,
    conversation_or_404,
    next_message_after,
    previous_user_message,
)
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
from .assistant_stream import stream_message_events

logger = logging.getLogger(__name__)


class AssistantRegenerateRequest(BaseModel):
    """重新生成只需要"这一次怎么生成"的运行时参数；问题与上下文都从原消息里取。"""

    model_config = ConfigDict(extra="forbid")

    reasoning_effort: str = ""
    compaction_threshold_tokens: int | None = Field(default=None, ge=1, le=2_000_000)
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
    if next_message_after(db, conversation_id, message_id) is not None:
        raise HTTPException(status_code=409, detail="只能重新生成最后一条回答")
    user_message = previous_user_message(db, conversation_id, message_id)
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
        compaction_threshold_tokens=request_payload.compaction_threshold_tokens,
        quoted_message_id=user_message.quoted_message_id,
    )


@dataclass(frozen=True)
class _RegeneratePrep:
    """重新生成的准备结果（worker 产出）：事件循环只拿普通结构建 SSE，不再碰 Session。"""

    replay: AssistantMessageCreate
    attachments: list[dict[str, Any]]
    provider: Any
    history: list[dict[str, Any]]
    context_blocks: list[str]
    context_metadata: dict[str, Any]
    user_message_id: int
    new_message_id: int
    generated_title: str
    system_prompt: str
    quoted: dict[str, Any] | None
    audit_scope: dict[str, Any]


def _prepare_regeneration(
    db: Session,
    conversation_id: int,
    message_id: int,
    payload: AssistantRegenerateRequest,
    surface: ConversationSurface,
) -> _RegeneratePrep:
    """读齐重跑所需的一切，并写入"旧回答 superseded + 新消息 pending"。

    **顺序与拆分前逐字一致**：先把所有可能失败的准备做完（provider、系统提示词），再动
    数据库——否则"旧回答已标 superseded、新消息没建出来"会留下一段点不开的历史。
    审计上下文的值在这里算好带走，由路由在事件循环上调用 ``set_ambient_scope``。
    """
    conversation = conversation_or_404(db, conversation_id, surface)
    target, user_message = _regenerable_pair(db, conversation_id, message_id)
    replay = _replay_payload(user_message, payload)
    relaxed_mode = resolve_assistant_relaxed_mode(db, payload.relaxed_mode)
    # 目标语言优先取用户保存的界面语言；没保存过就用默认审计语言（与消息入口同口径）。
    language = get_ui_locale(db) or DEFAULT_AUDIT_LANGUAGE
    # 引用的岗位/简历不存在时，`load_local_context` 自己抛固定文案的 404。
    context_blocks, context_metadata = load_local_context(db, replay, relaxed=relaxed_mode)
    # T24：技能是消息级的，重跑要沿用**原消息**当时勾选的技能提示词——它存在原用户
    # 消息的 context 里，重放请求不再带 skill_ids（那是发送时的一次性输入）。
    original_context = user_message.context if isinstance(user_message.context, dict) else {}
    if original_context.get("skill_prompt"):
        context_metadata["skill_prompt"] = original_context["skill_prompt"]
        context_metadata["skills"] = list(original_context.get("skills") or [])
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
    new_message_id = int(new_message.id)
    user_message_id = int(user_message.id)
    db.close()
    return _RegeneratePrep(
        replay=replay,
        attachments=attachments,
        provider=provider,
        history=history,
        context_blocks=context_blocks,
        context_metadata=context_metadata,
        user_message_id=user_message_id,
        new_message_id=new_message_id,
        generated_title=generated_title,
        system_prompt=system_prompt,
        quoted=quoted_snapshot,
        audit_scope={
            "input_scope": "assistant_context",
            "masked": not relaxed_mode,
            "language": language,
            "budget": DEFAULT_AUDIT_BUDGET,
        },
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
        # RF-02：准备段（读会话/原消息/放宽模式/引用上下文/配置/历史 + 写新消息行并提交）
        # 是**一整段同步数据库工作**，交给 worker；事件循环只 await 模型流。
        prep = await run_sync(
            _prepare_regeneration, db, conversation_id, message_id, payload, surface
        )
        # 审计 ContextVar 只能在事件循环上写：worker 线程拿的是 context 副本，
        # 在里面 set 不会传播到 SSE 生成器（用量会退回中间件默认值）。
        set_ambient_scope(**prep.audit_scope)
        logger.info(
            "助手重新生成 conversation_id=%s old_message_id=%s new_message_id=%s",
            conversation_id,
            message_id,
            prep.new_message_id,
        )
        return StreamingResponse(
            stream_message_events(
                payload=prep.replay,
                attachments=prep.attachments,
                provider=prep.provider,
                history=prep.history,
                context_blocks=prep.context_blocks,
                context_metadata=prep.context_metadata,
                user_message_id=prep.user_message_id,
                assistant_message_id=prep.new_message_id,
                generated_title=prep.generated_title,
                system_prompt=prep.system_prompt,
                quoted=prep.quoted,
                conversation_id=conversation_id,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


__all__ = ["AssistantRegenerateRequest", "register_regenerate_routes"]
