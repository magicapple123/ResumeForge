# SPDX-License-Identifier: Apache-2.0
"""求职助手的回合编排入口（从 api/assistant_stream.py 下沉）。

一轮回答的外层骨架留在这里：建运行状态（StreamRun）、把轮循环与成功/失败收尾串起来、
统一 4 个 except 分支与 finally 清理。具体编排（消息装配、模型轮次与工具循环、成功与
失败收尾）在 assistant_stream_run；拆分只为各自的职责边界与 500 行预算。

联网搜索**只由模型通过 web_search 工具发起**：打开开关等于"允许联网"，应用不会在
用户提问后抢先搜一次——搜不搜、搜什么由模型自己判断。
"""

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import aclosing
from typing import Any

from ...runtime.operation_budget import OperationCancelled
from ...schemas.assistant import AssistantMessageCreate
from .. import settings_service
from ..assistant_limits import DEFAULT_MAX_TOOL_ROUNDS
from ..assistant_limits import truncate_tool_result as truncate_tool_result
from ..llm.base import BaseLLMProvider, LLMError
from ..llm.usage import FINISH_BUDGET_EXHAUSTED
from .assistant_context_policy import model_error_event
from .assistant_persistence import cancel_pending_assistant_message
from .assistant_stream_run import MAX_REASONING_CONTEXT_CHARS as MAX_REASONING_CONTEXT_CHARS
from .assistant_stream_run import _finalize_run, _finish_success, _open_stream_run, _run_rounds
from .assistant_tool_exec import close_run_trace

logger = logging.getLogger(__name__)

# 一次回复里最多允许几轮工具调用；防止模型在两个工具之间来回打转。
# 这里只是**默认值**：真正的上限在设置页可改（AppSetting，见
# services/assistant_limits），循环里逐轮重读；保留这个模块级常量是因为
# api/assistant_stream 与既有测试按模块属性取符号，它同时是 DB 缺省时的兜底。
MAX_TOOL_ROUNDS = DEFAULT_MAX_TOOL_ROUNDS
# 一轮回答里最多搜几次网，**全部由 web_search 工具发起**。系统提示、README 与使用指南
# 都写着"最多 3 次"，这里把它变成真的：此前只有提示词里那句话，代码侧真正的约束是 5 轮
# 工具调用，而且每轮可以并行发多个搜索——用户按文档预期 3 次，实际可能多花好几倍。
MAX_WEB_SEARCHES = 3
# 失败收尾的固定脱敏文案（异常原文绝不能进 SSE 与落库，CodeQL stack-trace-exposure
# 修复的一部分）；预算路径的"结束原因如实记 budget_exhausted"由 usage_finish_reason 表达。
BUDGET_EXHAUSTED_EVENT = {"type": "error", "message": "回复超出时间预算，已中止"}
INTERNAL_ERROR_EVENT = {"type": "error", "message": "回复过程中发生内部错误，请查看后端日志"}


async def _stream_message_events(
    *,
    factory: Any,
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
) -> AsyncGenerator[str, None]:
    run = _open_stream_run(
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
        async with aclosing(_run_rounds(run)) as rounds:
            async for event in rounds:
                yield event
        async with aclosing(_finish_success(run)) as success:
            async for event in success:
                yield event
    except OperationCancelled as exc:
        # RF-14 §2.1.b-4：整链预算到期按 error 收尾，结束原因如实记 budget_exhausted——
        # 不冒充网络错误，也不归入用户取消分支（cancelled）。
        logger.warning("AI 助手回复超出时间预算，已中止：%s", exc)
        async for event in _finalize_run(
            run,
            "error",
            error_event=BUDGET_EXHAUSTED_EVENT,
            usage_finish_reason=FINISH_BUDGET_EXHAUSTED,
        ):
            yield event
    except asyncio.CancelledError:
        # 用户断开（浏览器取消）路径同样收集最后一轮 usage：能拿到多少算多少。
        async for event in _finalize_run(run, "cancelled", rereraise=True):
            yield event
    except LLMError as exc:
        logger.warning("AI 助手模型调用失败（用户可见错误已固定脱敏）")
        async for event in _finalize_run(run, "error", error_event=model_error_event(exc)):
            yield event
    except Exception:  # noqa: BLE001 - 流式响应必须转换内部异常
        logger.exception("AI 助手流式回复发生内部错误")
        async for event in _finalize_run(run, "error", error_event=INTERNAL_ERROR_EVENT):
            yield event
    finally:
        settings_service.reset_runtime_relaxed_override(run.override_token)  # 覆盖不能跨请求泄漏
        # 活预算接线复位（防御性纪律，provider 实例不复用）；GeneratorExit（浏览器
        # 断开）也可能走这里，cancel_pending 在任何路径上都要把 pending 消息收尾。
        provider.request_budget = None
        # T21：正常/异常/断流都在这里收尾（成功路径已在 finish 前写过，重复调用是幂等的）。
        close_run_trace(run.trace, run.assistant_context, run.assistant_message_id, run.factory)
        # Closing an async generator can bypass CancelledError when the browser断开。
        cancel_pending_assistant_message(
            run.assistant_message_id, "".join(run.parts), factory=run.factory
        )
