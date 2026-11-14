# SPDX-License-Identifier: Apache-2.0
"""模型上下文窗口表（2026-11-13 核对）与解析规则。

为什么需要它：同一个 prompt 在不同模型上的安全预算差十倍。窗口填大了会 400（还白烧一次
调用），填小了会提前压缩、丢掉本来装得下的上下文。表里每条都带官方文档链接，核对时
直接点开对照；**具体型号排在家族规则之前**（如 ``gpt-4.1`` 必须先于 ``gpt-4o`` 的家族
规则命中），否则会被宽规则抢走。

未知型号一律回落到 128k 的保守值，并把来源标成 ``fallback``——界面上要能看出"这个窗口
不是查到的，是估的"。用户手填的值优先级最高（包括带 provider 前缀的型号名）。
"""

import re
from dataclasses import dataclass
from typing import Literal

# 未知型号的保守值：宁可少塞上下文，也不要发一次必然 400 的请求。
DEFAULT_CONTEXT_WINDOW = 128_000
WindowSource = Literal["manual", "reference", "fallback"]


@dataclass(frozen=True)
class WindowRule:
    """一条窗口参考：给人看的型号名 + 匹配正则 + 窗口大小 + 官方文档。

    ``label`` 只用于「模型窗口参考」列表；解析仍走 ``pattern``，两者不要互相推导——
    型号名里常有斜杠与空格，不能当正则用。
    """

    label: str
    pattern: str
    tokens: int
    reference: str


# 顺序即优先级：具体型号在家族规则之前；每条都带官方文档链接，便于复核。
MODEL_WINDOWS: tuple[WindowRule, ...] = (
    WindowRule(
        "GPT-4.1",
        r"gpt-4[.]1(?![0-9])",
        1_047_576,
        "https://developers.openai.com/api/docs/models/gpt-4.1",
    ),
    WindowRule(
        "GPT-4o",
        r"gpt-4o(?![a-z0-9])",
        128_000,
        "https://developers.openai.com/api/docs/models/gpt-4o",
    ),
    WindowRule(
        "GPT-6 Astra / Sol",
        r"gpt-6-(?:astra|sol)(?![a-z0-9])",
        1_050_000,
        "https://developers.openai.com/api/docs/models",
    ),
    WindowRule(
        "Claude Opus / Sonnet / Haiku 4.5",
        r"claude-(?:opus|sonnet|haiku)-4[.-]5(?![0-9])",
        200_000,
        "https://platform.claude.com/docs/en/models/overview",
    ),
    WindowRule(
        "Claude Opus 4.6–4.8 / Sonnet 4.6",
        r"claude-(?:opus-4[.-][678]|sonnet-4[.-]6)(?![0-9])",
        1_000_000,
        "https://platform.claude.com/docs/en/models/overview",
    ),
    WindowRule(
        "Gemini 3.8 Flash",
        r"gemini-3[.]8-flash(?![a-z0-9])",
        1_048_576,
        "https://aistudio.google.com/docs/models/gemini-3.8-flash",
    ),
    WindowRule(
        "Gemini 4 Carbon / Argon / Hydrogen",
        r"gemini-4-(?:carbon|argon|hydrogen)(?![a-z0-9])",
        1_000_000,
        "https://aistudio.google.com/docs/models",
    ),
    WindowRule(
        "DeepSeek Flash / V4 Pro",
        r"deepseek-(?:flash|v4-pro(?:-0813)?)(?![a-z0-9])",
        1_000_000,
        "https://api-docs.deepseek.com/quick_start/pricing/",
    ),
    WindowRule(
        "Qwen3.8 Max / Flash",
        r"qwen3[.]8-(?:max|flash)(?![a-z0-9])",
        1_000_000,
        "https://help.aliyun.com/zh/model-studio/text-generation-model",
    ),
    WindowRule(
        "Qwen3.7 Plus / Max / Flash",
        r"qwen3[.]7-(?:plus|max|flash)(?![a-z0-9])",
        1_000_000,
        "https://help.aliyun.com/zh/model-studio/text-generation-model",
    ),
    WindowRule(
        "GLM-5.3",
        r"glm-5[.]3(?![0-9])",
        1_000_000,
        "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3",
    ),
    WindowRule(
        "Kimi K3 / K3.1 Pro",
        r"kimi-k3(?:[.]1-pro)?(?![a-z0-9.])",
        1_000_000,
        "https://platform.kimi.ai/docs/models",
    ),
    WindowRule(
        "MiniMax M3",
        r"minimax-m3(?![a-z0-9])",
        1_000_000,
        "https://platform.minimax.io/docs/guides/models-intro",
    ),
    WindowRule(
        "Grok 4.7",
        r"grok-4[.]7(?![0-9])",
        500_000,
        "https://docs.x.ai/developers/models/grok-4.7",
    ),
)


@dataclass(frozen=True)
class ModelWindow:
    tokens: int
    source: WindowSource


def matched_window(model: str) -> WindowRule | None:
    """按表里的顺序找第一条命中的规则；没有就返回 None（由调用方回退保守值）。"""
    for rule in MODEL_WINDOWS:
        if re.search(rule.pattern, model or "", re.IGNORECASE):
            return rule
    return None


def resolve_model_window(model: str, manual_tokens: int = 0) -> ModelWindow:
    """An explicit user value wins, including for provider-prefixed model names."""
    if manual_tokens > 0:
        return ModelWindow(int(manual_tokens), "manual")
    rule = matched_window(model)
    if rule is not None:
        return ModelWindow(rule.tokens, "reference")
    return ModelWindow(DEFAULT_CONTEXT_WINDOW, "fallback")


def configured_model_window(config: object) -> ModelWindow:
    return resolve_model_window(
        str(getattr(config, "model", "") or ""),
        int(getattr(config, "context_window_tokens", 0) or 0),
    )


__all__ = [
    "DEFAULT_CONTEXT_WINDOW",
    "MODEL_WINDOWS",
    "ModelWindow",
    "WindowRule",
    "WindowSource",
    "configured_model_window",
    "matched_window",
    "resolve_model_window",
]
