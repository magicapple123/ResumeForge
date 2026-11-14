# SPDX-License-Identifier: Apache-2.0
"""求职助手的流级租约入口（从 ``api/assistant_stream.py`` 下沉）。

职责只有一件：建流先取数据集租约、按值冻结 engine，再把回合编排（``assistant_stream_turns``）
包起来；浏览器断开时显式 aclose 内层，让收尾逻辑（pending 消息转 cancelled）一定执行。
公开符号与常量在此再导出，``api/assistant_stream.py`` 因此只是一层薄壳。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetScopeError
from ...schemas.assistant import AssistantMessageCreate
from ..llm.base import BaseLLMProvider
from .assistant_persistence import format_sse
from .assistant_stream_turns import (
    MAX_REASONING_CONTEXT_CHARS as MAX_REASONING_CONTEXT_CHARS,
)
from .assistant_stream_turns import MAX_TOOL_ROUNDS as MAX_TOOL_ROUNDS
from .assistant_stream_turns import MAX_WEB_SEARCHES as MAX_WEB_SEARCHES
from .assistant_stream_turns import _stream_message_events


async def stream_message_events(
    *,
    payload: AssistantMessageCreate,
    attachments: list[dict[str, Any]],
    provider: BaseLLMProvider,
    history: list[dict[str, Any]],
    context_blocks: list[str],
    context_metadata: dict[str, Any],
    user_message_id: int,
    assistant_message_id: int,
    generated_title: str,
    system_prompt: str,
    quoted: dict[str, Any] | None = None,
    conversation_id: int | None = None,
) -> AsyncIterator[str]:
    """流级租约入口（RF-03）：建流先取租约，切换持锁期间给出可读的 error 事件。

    拿到租约后按值冻结当前 engine，流内全部会话（工具调用、上下文写回、收尾）
    都从它建——即使之后发生切换，也绝不漂到新库。切换进行中有流活动时选择
    **直接报错（409 语义）而不是排队**：助手流持续几十秒到几分钟，排队需要跨请求
    协调且用户无感知地等，明确报"数据集正在切换中"最诚实，也与切换侧的排空
    超时语义一致。放宽模式请求覆盖优先、抓取条数每轮工具循环重读设置（RF-01）。
    """
    try:
        lease = dataset_scope.acquire_lease("assistant-stream")
    except DatasetScopeError:
        # 不读 `exc.public_message`：异常对象进响应会被 CodeQL 判成 stack-trace-exposure。
        # 四种闸门失败对用户是同一件事（刷新后重试），用一条固定文案覆盖。
        yield format_sse(
            {
                "type": "error",
                "message": "数据集已切换或正在切换，请保留草稿并刷新页面后重试",
            }
        )
        return
    # 租约在手：身份不会再变（切换会被排空挡住），此刻冻结的就是流全程的库。
    factory = dataset_scope.frozen_session_factory()
    inner = _stream_message_events(
        factory=factory,
        payload=payload,
        attachments=attachments,
        provider=provider,
        history=history,
        context_blocks=context_blocks,
        context_metadata=context_metadata,
        user_message_id=user_message_id,
        assistant_message_id=assistant_message_id,
        generated_title=generated_title,
        system_prompt=system_prompt,
        quoted=quoted,
        conversation_id=conversation_id,
    )
    try:
        async for event in inner:
            yield event
    finally:
        # GeneratorExit 只会抛进外层生成器，async for 不会把关闭传播给内层——
        # 浏览器断开时必须显式 aclose 内层，它 finally 里的
        # cancel_pending_assistant_message 才能把 pending 消息收尾成 cancelled。
        try:
            await inner.aclose()
        finally:
            lease.release()


__all__ = [
    "MAX_REASONING_CONTEXT_CHARS",
    "MAX_TOOL_ROUNDS",
    "MAX_WEB_SEARCHES",
    "stream_message_events",
]
