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
    set_ambient_scope(
        input_scope="assistant_context",
        masked=not relaxed_mode,
        language=get_ui_locale(db) or payload.locale or DEFAULT_AUDIT_LANGUAGE,
        # 助手是多轮工具循环，单轮输出仍受 provider 默认约束；审计按应用默认输出
        # 上界声明预算（A1：不再留 None，否则分不清"没声明"与"不限制"）。
        budget=DEFAULT_AUDIT_BUDGET,
    )
    context_blocks, context_metadata = load_local_context(db, payload, relaxed=relaxed_mode)
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
    )


__all__ = [
    "MessageDispatch",
    "MessageDispatchError",
    "prepare_message_dispatch",
    "save_attachment_copies",
]
