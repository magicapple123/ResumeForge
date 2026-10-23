# SPDX-License-Identifier: Apache-2.0
"""模型调用用量的兼容层（RF-14 §2.2）。

返回通道（兼容性核心）：``chat() / stream_chat() / stream_chat_events()`` 的返回签名
**一律不改**——测试假 Provider 全是 ``(config) / (messages)`` 签名，改签名会全线崩。
用量通过 provider 实例的 ``last_usage`` 属性暴露（只保留最后一次调用；跨轮累计是
调用方责任，provider 不跨调用累计）。

诚实呈现原则（本契约的灵魂）：服务商未提供用量时 token 字段为 ``None``——展示
「未知」，**禁止伪造 0**，也禁止用字符数折算成"精确" token 数冒充真实值。
本模块不含 prompt/response 内容（隐私边界：日志与落库都不允许记录它们）。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

# finish_reason 的取值域：协议值原样归一；中断按中断类型归类。
FINISH_STOP = "stop"
FINISH_LENGTH = "length"
FINISH_TOOL_CALLS = "tool_calls"
FINISH_CANCELLED = "cancelled"
FINISH_BUDGET_EXHAUSTED = "budget_exhausted"
FINISH_ERROR = "error"


@dataclass(frozen=True)
class LLMUsage:
    """一次模型调用的用量记录。**不含 prompt/response 内容**（隐私边界）。"""

    model: str  # 实际请求的模型标识（config.model）
    prompt_tokens: int | None  # 服务商未提供 → None；展示「未知」；禁止伪造 0
    completion_tokens: int | None
    total_tokens: int | None  # 仅两项都存在时 = a + b，否则 None
    elapsed_ms: int  # 本次调用本地墙钟（恒可得）
    finish_reason: str  # stop | length | tool_calls | cancelled | budget_exhausted | error
    retries: int = 0  # 传输层重试次数（§2.4）

    def to_dict(self) -> dict:
        """可序列化形态（进 SSE / ChatMessage.context）。缺失值是 null，不是 0。"""
        return {
            "model": self.model,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "elapsed_ms": self.elapsed_ms,
            "finish_reason": self.finish_reason,
            "retries": self.retries,
        }


def build_usage(
    model: str,
    *,
    elapsed_ms: int,
    finish_reason: str,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    retries: int = 0,
) -> LLMUsage:
    """统一构造入口：total_tokens 只在两项都存在时求和，否则保持 None。"""
    total = (
        prompt_tokens + completion_tokens
        if prompt_tokens is not None and completion_tokens is not None
        else None
    )
    return LLMUsage(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total,
        elapsed_ms=elapsed_ms,
        finish_reason=finish_reason,
        retries=retries,
    )


def _clean_token(value: object) -> int | None:
    """服务商给的 token 数必须是真正的非负整数；缺失/异常形态一律 None，不臆造。"""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


def extract_openai_usage(usage: object) -> tuple[int | None, int | None]:
    """从 OpenAI 兼容响应（或流式 usage 帧）的 usage 对象提取 ``(prompt, completion)``。"""
    if not isinstance(usage, dict):
        return None, None
    return _clean_token(usage.get("prompt_tokens")), _clean_token(usage.get("completion_tokens"))


def summarize_usages(
    usages: Iterable[LLMUsage], *, finish_reason: str | None = None
) -> dict | None:
    """把一次回答里各轮调用的用量汇总成总口径（跨轮累计是调用方责任）。

    token 字段只有在**每一轮都有值**时才求和——部分缺失时宁可给 None（展示「未知」），
    也不给一个会被误读为完整值的部分和。空列表返回 None，调用方据此省略 usage 键。
    """
    records = list(usages)
    if not records:
        return None

    def _sum(values: list[int | None]) -> int | None:
        # 逐项累加而不是 `sum(values)`：只有**每一项都有值**才给和，缺一个就整体
        # 报"未知"——部分和会被误读成完整值。逐个判空也让类型收窄成立。
        total = 0
        for value in values:
            if value is None:
                return None
            total += value
        return total

    last = records[-1]
    return {
        "model": last.model,
        "prompt_tokens": _sum([record.prompt_tokens for record in records]),
        "completion_tokens": _sum([record.completion_tokens for record in records]),
        "total_tokens": _sum([record.total_tokens for record in records]),
        "elapsed_ms": sum(record.elapsed_ms for record in records),
        "finish_reason": finish_reason or last.finish_reason,
        "retries": sum(record.retries for record in records),
    }


def openai_chat_outcome(data: object) -> tuple[int | None, int | None, str]:
    """非流式 OpenAI 兼容响应的 ``(prompt, completion, finish_reason)`` 提取。

    ``data`` 可能不是 dict（非法响应形态）：这里容错返回 ``(None, None, "stop")``，
    真正的形态校验由调用方的 ``_extract_content`` 抛 LLMError。
    """
    if not isinstance(data, dict):
        return None, None, FINISH_STOP
    prompt, completion = extract_openai_usage(data.get("usage"))
    choices = data.get("choices") or []
    first = choices[0] if isinstance(choices, list) and choices else {}
    protocol_reason = (
        first.get("finish_reason")
        if isinstance(first, dict) and first.get("finish_reason")
        else None
    )
    return prompt, completion, (str(protocol_reason) if protocol_reason else FINISH_STOP)


def merge_openai_stream_usage(
    prompt: int | None, completion: int | None, frame: object
) -> tuple[int | None, int | None]:
    """把流式帧里服务商自带的 usage 并进当前捕获值（缺失/非整数的字段不覆盖）。"""
    new_prompt, new_completion = extract_openai_usage(
        frame.get("usage") if isinstance(frame, dict) else None
    )
    return (
        new_prompt if new_prompt is not None else prompt,
        new_completion if new_completion is not None else completion,
    )


def usage_log_line(usage: LLMUsage, *, estimated_prompt_tokens: int | None = None) -> str:
    """把用量记录拼成结构化日志字段串（生成任务的模型用量日志与未来消费方共用）。

    只含 model / token 计数 / 耗时 / 结束原因 / 重试次数——**绝不包含 prompt/
    response 内容或密钥**（隐私边界）。``estimated_prompt_tokens`` 只在估算开启时
    出现，与真实 tokens 明确分开命名（§2.5）。
    """
    fields = [
        f"model={usage.model}",
        f"prompt_tokens={usage.prompt_tokens}",
        f"completion_tokens={usage.completion_tokens}",
        f"total_tokens={usage.total_tokens}",
        f"elapsed_ms={usage.elapsed_ms}",
        f"finish_reason={usage.finish_reason}",
        f"retries={usage.retries}",
    ]
    if estimated_prompt_tokens is not None:
        fields.append(f"estimated_prompt_tokens={estimated_prompt_tokens}")
    return " ".join(fields)


__all__ = [
    "FINISH_BUDGET_EXHAUSTED",
    "FINISH_CANCELLED",
    "FINISH_ERROR",
    "FINISH_LENGTH",
    "FINISH_STOP",
    "FINISH_TOOL_CALLS",
    "LLMUsage",
    "build_usage",
    "extract_openai_usage",
    "merge_openai_stream_usage",
    "openai_chat_outcome",
    "summarize_usages",
    "usage_log_line",
]
