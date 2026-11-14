# SPDX-License-Identifier: Apache-2.0
"""一次请求内的上下文阈值，以及最后一道"窗口装不装得下"的闸门。

为什么要这一层：窗口大小来自模型表，压缩阈值来自全局设置，两者都可能"看起来够、实际
不够"——消息本身、系统提示、工具定义、本轮新输入都要算进去。这里把三件事收口：

- :func:`request_compaction_limits`：按窗口把百分比阈值折成 token，并压到窗口的 90%
  （``SAFE_WINDOW_RATIO``）以内——超过这个比例的请求，provider 侧大概率直接 400；
- :func:`ensure_context_fits`：压缩之后仍放不下就抛 ``ContextWindowExceeded``，而不是把
  超长请求发出去（那会烧一次必然失败的调用，用户还看不到原因）；
- :func:`with_window_policy`：把窗口来源（manual / reference / fallback）与本次触发线
  一起带回前端，用户能看出"为什么这次提前压缩了"。
"""

from dataclasses import replace
from typing import Any

from ..llm.base import LLMError
from ..model_context_windows import ModelWindow
from .assistant_compaction import messages_tokens
from .assistant_compaction_plan import CompactionLimits
from .assistant_context_usage import _consistent_percents

# 90% 是经验上限：再往上，provider 侧的分词差异与本轮新增内容会把请求顶过窗口。
SAFE_WINDOW_RATIO = 0.9


# 文案只留一份：抛出点与 SSE 事件共用，事件里不写 `str(error)`（异常对象进响应会被
# CodeQL 判成 stack-trace-exposure）。
CONTEXT_WINDOW_EXCEEDED_MESSAGE = "当前模型窗口不足，压缩后仍无法容纳，请新建对话"


class ContextWindowExceeded(LLMError):
    """The current model cannot safely accept this conversation."""


def stored_context_usage(message: Any) -> dict[str, Any] | None:
    if message is None:
        return None
    context = message.context if isinstance(message.context, dict) else {}
    usage = context.get("context_usage")
    return usage if isinstance(usage, dict) else None


def model_error_event(error: LLMError) -> dict[str, Any]:
    if isinstance(error, ContextWindowExceeded):
        return {
            "type": "error",
            "message": CONTEXT_WINDOW_EXCEEDED_MESSAGE,
            "code": "context_window",
        }
    if getattr(error, "context_length_error", False):
        return {
            "type": "error",
            "message": "模型上下文长度超限，请调低窗口后重试",
            "code": "context_length",
        }
    return {"type": "error", "message": "模型服务暂时无法处理本次请求，请稍后重试"}


def request_compaction_limits(
    window_tokens: int, defaults: CompactionLimits, threshold_tokens: int | None = None
) -> CompactionLimits:
    threshold = min(
        threshold_tokens
        if threshold_tokens is not None
        else window_tokens * defaults.summary_percent / 100,
        int(window_tokens * SAFE_WINDOW_RATIO),
    )
    percent = max(0.0, threshold / max(1, window_tokens) * 100)
    return replace(
        defaults, mask_percent=min(defaults.mask_percent, percent), summary_percent=percent
    )


def with_window_policy(
    usage: dict[str, Any],
    window: ModelWindow,
    limits: CompactionLimits,
    default_limits: CompactionLimits | None = None,
) -> dict[str, Any]:
    buckets = [dict(bucket) for bucket in usage.get("buckets", [])]
    percents, _total = _consistent_percents(
        [int(bucket.get("tokens") or 0) for bucket in buckets], window.tokens
    )
    for bucket, percent in zip(buckets, percents, strict=True):
        bucket["percent"] = percent
    return {
        **usage,
        "buckets": buckets,
        "window": window.tokens,
        "window_source": window.source,
        "percent": round(int(usage.get("total") or 0) / window.tokens * 100, 1),
        "trigger_tokens": round(window.tokens * limits.summary_percent / 100),
        "default_trigger_tokens": round(
            window.tokens * (default_limits or limits).summary_percent / 100
        ),
    }


def ensure_context_fits(
    messages: list[dict[str, Any]], window_tokens: int, extra_tokens: int = 0
) -> None:
    if messages_tokens(messages) + extra_tokens > int(window_tokens * SAFE_WINDOW_RATIO):
        raise ContextWindowExceeded(CONTEXT_WINDOW_EXCEEDED_MESSAGE)


async def compact_turn_context(
    messages: list[dict[str, Any]],
    *,
    usage: dict[str, Any],
    window: ModelWindow,
    threshold_tokens: int | None,
    factory: Any,
    conversation_id: int | None,
    provider: Any,
    history: list[dict[str, Any]],
    history_count: int,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    from .assistant_compaction_settings import get_compaction_settings
    from .assistant_compaction_store import compact_before_model

    with factory() as db:
        default_limits = request_compaction_limits(
            window.tokens, get_compaction_settings(db).limits
        )
        limits = request_compaction_limits(window.tokens, default_limits, threshold_tokens)
    extra_tokens = max(0, int(usage.get("total") or 0) - messages_tokens(messages))
    oversized = messages_tokens(messages) + extra_tokens > int(window.tokens * SAFE_WINDOW_RATIO)
    percent = int(usage.get("total") or 0) / window.tokens * 100
    current, flags = await compact_before_model(
        messages,
        history=history,
        history_count=history_count,
        factory=factory,
        conversation_id=conversation_id,
        provider=provider,
        window_tokens=window.tokens,
        percent=percent,
        limits=limits,
    )
    if oversized:
        ensure_context_fits(current, window.tokens, extra_tokens)
    return current, flags, with_window_policy(usage, window, limits, default_limits)
