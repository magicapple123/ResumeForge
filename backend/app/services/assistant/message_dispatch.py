# SPDX-License-Identifier: Apache-2.0
"""助手发消息的入流准备（T2：从 `api/assistant.py` 的 send_message 下沉）。

这里负责"流开始之前"的全部业务：会话校验、附件规范化、放宽模式判定、上下文分块、
模型配置检查、引用快照、用户/助手消息行落库（`flush` 拿主键）、provider 构造与系统
提示词装配。流本身（租约 + 回合编排 + SSE 帧）仍由
`services/assistant/assistant_stream_events.py` 的 `stream_message_events` 承担。

**事务边界留在路由**：本模块只 `add_all/flush`，消息行提交、附件磁盘副本与
`db.close()` 由 `send_message` 路由收尾（"提交后附件副本失败不影响已发消息"的既有
语义因此不变）。

**打桩点**：`load_llm_config` / `create_provider` 由路由以参数注入。测试打桩的是
`app.api.assistant` 命名空间上的这两个名字（见 tests/_assistant_breadth_support.py），
路由在调用期读取后传入，补丁落点与约束力保持原样。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import ChatMessage
from ...models.profile import utcnow
from ...schemas.assistant import AssistantMessageCreate, ConversationSurface
from ..llm.usage_tasks import (
    DEFAULT_AUDIT_BUDGET,
    DEFAULT_AUDIT_LANGUAGE,
    set_ambient_scope,
)
from ..settings_service import resolve_assistant_relaxed_mode
from ..ui_locale import get_ui_locale
from ..user_files import save_from_data_url
from .assistant_context import load_local_context
from .assistant_conversations import DEFAULT_TITLE, conversation_or_404
from .assistant_persistence import history_snapshot
from .assistant_service import conversation_title, normalize_attachments_for_api
from .assistant_skill_prompt import _compose_skill_prompt
from .assistant_skills import (
    MAX_SKILL_PROMPT_CHARS,
    PendingSkillError,
    skills_for_ids,
    validate_conversation_skill_ids,
)
from .assistant_stream_events import stream_message_events
from .assistant_system_prompt import _system_prompt

logger = logging.getLogger(__name__)


class MessageDispatchError(Exception):
    """入流准备失败：status_code / detail 由路由映射成 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class MessageDispatch:
    """一次助手发消息的入流参数：路由拿它建 StreamingResponse（不再回表）。"""

    payload: AssistantMessageCreate
    attachments: list[dict[str, Any]]
    provider: Any
    history: list[dict[str, Any]]
    context_blocks: list[str]
    context_metadata: dict[str, Any]
    user_message_id: int
    assistant_message_id: int
    generated_title: str
    system_prompt: str
    quoted: dict[str, Any] | None
    conversation_id: int
    # RF-02：入流准备搬到 worker 之后，ContextVar 不能在 worker 里写（anyio 的线程拿的是
    # context 副本，值不会回到事件循环）。准备阶段把该写的值算好带走，由路由在**事件循环**
    # 上调用 ``set_ambient_scope(**audit_scope)``，SSE 期间 provider 才能按同一份口径记账。
    audit_scope: dict[str, Any]

    def event_stream(self) -> AsyncIterator[str]:
        """把入流参数原样交给 SSE 唯一实现（序列化与帧格式在那里）。"""
        return stream_message_events(
            payload=self.payload,
            attachments=self.attachments,
            provider=self.provider,
            history=self.history,
            context_blocks=self.context_blocks,
            context_metadata=self.context_metadata,
            user_message_id=self.user_message_id,
            assistant_message_id=self.assistant_message_id,
            generated_title=self.generated_title,
            system_prompt=self.system_prompt,
            quoted=self.quoted,
            conversation_id=self.conversation_id,
        )


def save_attachment_copies(db: Session, dispatch: MessageDispatch) -> None:
    """best-effort：把消息附件里的 data URL 落一份磁盘副本（失败只记日志）。"""
    for item in dispatch.attachments or []:
        if not isinstance(item, dict):
            continue
        data_url = str(item.get("data_url") or "")
        if not data_url:
            continue
        try:
            save_from_data_url(
                db,
                data_url,
                source_type="chat_attachment",
                source_ref=f"chat_message:{dispatch.user_message_id}",
                fallback_name=str(item.get("name") or ""),
                fallback_mime=str(item.get("mime_type") or ""),
            )
        except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住消息发送
            logger.warning(
                "助手附件磁盘副本保存失败 chat_message:%s",
                dispatch.user_message_id,
                exc_info=True,
            )


def assistant_audit_scope(*, relaxed_mode: bool, language: str) -> dict[str, Any]:
    """助手入口的审计输入边界（#35）：放宽模式开 = 不脱敏。

    返回值既用于**准备阶段就地写入**（同步调用方），也随 :class:`MessageDispatch`
    交给路由在**事件循环**上再写一次——RF-02 把准备段搬进 worker 后，worker 线程里的
    ContextVar 写入不会传播回 SSE，所以值必须随数据一起带出来。
    """
    return {
        "input_scope": "assistant_context",
        "masked": not relaxed_mode,
        "language": language,
        # 助手是多轮工具循环，单轮输出仍受 provider 默认约束；审计按应用默认输出
        # 上界声明预算（A1：不再留 None，否则分不清"没声明"与"不限制"）。
        "budget": DEFAULT_AUDIT_BUDGET,
    }


def resolve_message_skills(
    db: Session, payload: AssistantMessageCreate
) -> tuple[str, list[dict[str, Any]]]:
    """按本条消息的 ``skill_ids`` 解析技能并拼出提示词（T24：技能是消息级）。

    返回 ``(skill_prompt, skill_refs)``：提示词写进用户消息 ``context.skill_prompt``，
    由模型侧拼在**这条消息自己的正文之前**（历史消息同样带着它，续轮不断）；
    ``skill_refs`` 写进 ``context.skills``，只供界面渲染「使用 X」chip。

    校验复用对话级时代的 ``validate_conversation_skill_ids``：去重、≤8、存在性、
    待验证 → ``PendingSkillError``。后者转 409（前端提示"先在技能页确认"），
    其余 ``ValueError`` 转 422，与 PUT /skills 的错误语义保持一致。
    """
    try:
        skill_ids = validate_conversation_skill_ids(db, payload.skill_ids)
    except PendingSkillError as exc:
        raise MessageDispatchError(409, str(exc)) from None
    except ValueError as exc:
        raise MessageDispatchError(422, str(exc)) from None
    if not skill_ids:
        # 没有 skill_ids 时**不读** assistant_conversation_skill：旧关联行不算启用，
        # 否则"技能只作用于下一条消息"会被旧会话的历史设置悄悄破坏。
        return "", []
    skills = skills_for_ids(db, skill_ids)
    prompt, _truncated, _skipped, _loaded = _compose_skill_prompt(skills, MAX_SKILL_PROMPT_CHARS)
    # chip 展示用户勾选的全部技能（预算截断是服务端行为，不在 chip 上装作没选）。
    refs = [{"id": int(skill.id), "name": skill.name} for skill in skills]
    return prompt, refs


def prepare_message_dispatch(
    db: Session,
    conversation_id: int,
    payload: AssistantMessageCreate,
    surface: ConversationSurface,
    *,
    load_llm_config: Callable[[Session], Any],
    create_provider: Callable[[Any], Any],
) -> MessageDispatch:
    """把一条用户消息准备成可开流的状态（不提交：见模块 docstring 的事务边界说明）。"""
    conversation = conversation_or_404(db, conversation_id, surface)
    # 校验错误由服务层翻成固定文案的 422（normalize_attachments_for_api）；
    # 路由里不留异常处理器，CodeQL 的 stack-trace-exposure 才没有源点。
    attachments = normalize_attachments_for_api(payload.attachments)
    # 放宽模式：请求覆盖优先（None = 沿用全局设置）；流式期间请求会话已关闭，值绑进闭包。
    relaxed_mode = resolve_assistant_relaxed_mode(db, payload.relaxed_mode)
    # #35：助手入口的输入边界——放宽模式决定是否带身份字段（masked = 非放宽）。
    # 目标语言优先取用户显式保存的界面语言（/api/settings/locale，数据集内持久化，
    # 是唯一权威值）；用户还没保存过时退回本次请求可选携带的 locale；两者都没有就留空
    # （＝本次不涉及语言选择），而不是记成缺失。
    audit_scope = assistant_audit_scope(
        relaxed_mode=relaxed_mode,
        language=get_ui_locale(db) or payload.locale or DEFAULT_AUDIT_LANGUAGE,
    )
    # 仍在准备阶段写一次（本函数也可能被同步调用方使用）；路由会在事件循环上按同一份
    # 值再写一次——worker 线程里的写入不会传播回去，见 MessageDispatch.audit_scope。
    set_ambient_scope(**audit_scope)
    context_blocks, context_metadata = load_local_context(db, payload, relaxed=relaxed_mode)
    # T24：技能只作用于本条消息。提示词随消息落进 context，避免"下一轮还在悄悄生效"。
    skill_prompt, skill_refs = resolve_message_skills(db, payload)
    if skill_prompt:
        context_metadata["skill_prompt"] = skill_prompt
        context_metadata["skills"] = skill_refs
    config = load_llm_config(db)
    if not config.base_url or not config.model:
        raise MessageDispatchError(400, "尚未配置大模型 API")

    history = history_snapshot(db, conversation_id)
    had_messages = bool(history)
    # 「引用追问」：只允许引用同一会话的消息，并把快照存进 context（原消息删了仍可读）。
    quoted_snapshot: dict[str, Any] | None = None
    if payload.quoted_message_id is not None:
        quoted = db.get(ChatMessage, payload.quoted_message_id)
        if quoted is None or quoted.conversation_id != conversation_id:
            raise MessageDispatchError(404, "被引用的消息不存在或不在当前会话")
        quoted_snapshot = {
            "id": quoted.id,
            "role": quoted.role,
            "excerpt": quoted.content.strip()[:500],
        }
        context_metadata["quoted"] = quoted_snapshot
    user_message = ChatMessage(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
        quoted_message_id=payload.quoted_message_id,
        attachments=attachments,
        context=context_metadata,
        status="complete",
    )
    assistant_message = ChatMessage(
        conversation_id=conversation_id,
        role="assistant",
        status="pending",
        model=config.model,
    )
    db.add_all([user_message, assistant_message])
    if not had_messages and conversation.title == DEFAULT_TITLE:
        conversation.title = conversation_title(payload.content, attachments)
    conversation.updated_at = utcnow()
    # 主键要给附件副本与流式事件用；提交由路由收尾，而不是在这里结束事务。
    db.flush()
    # 思考强度只作用于本次调用：助手页可随时切换，不改写设置里的模型配置。直接设在
    # 实例上而不走 create_provider 参数——测试与自定义 provider 只实现 (config) 签名。
    # without_thinking() 剥掉设置页的「思考模式」（那是**除助手以外**的 AI 调用开关），
    # 助手只认这个单次请求级的选择。
    provider = create_provider(config.without_thinking())
    provider.request_overrides = {"reasoning_effort": payload.reasoning_effort}
    system_prompt = _system_prompt(
        db,
        relaxed=relaxed_mode,
        conversation_id=conversation_id,
        client_context=payload.client_context,
    )
    return MessageDispatch(
        payload=payload,
        attachments=attachments,
        provider=provider,
        history=history,
        context_blocks=context_blocks,
        context_metadata=context_metadata,
        user_message_id=int(user_message.id),
        assistant_message_id=int(assistant_message.id),
        generated_title=conversation.title,
        system_prompt=system_prompt,
        quoted=quoted_snapshot,
        conversation_id=conversation_id,
        audit_scope=audit_scope,
    )


__all__ = [
    "MessageDispatch",
    "MessageDispatchError",
    "prepare_message_dispatch",
    "resolve_message_skills",
    "save_attachment_copies",
]
