# SPDX-License-Identifier: Apache-2.0
"""模型上下文窗口表（2026-11-23 核对）与解析规则。

为什么需要它：同一个 prompt 在不同模型上的安全预算差十倍。窗口填大了会 400（还白烧一次
调用），填小了会提前压缩、丢掉本来装得下的上下文。表里每条都带官方文档链接，核对时
直接点开对照；**具体型号排在家族规则之前**（如 ``gpt-4.1`` 必须先于 ``gpt-4o`` 的家族
规则命中），否则会被宽规则抢走。

未知型号一律回落到 128k 的保守值，并把来源标成 ``fallback``——界面上要能看出"这个窗口
不是查到的，是估的"。用户手填的值优先级最高（包括带 provider 前缀的型号名）。
"""

import re
from dataclasses import dataclass

# 未知型号的保守值：宁可少塞上下文，也不要发一次必然 400 的请求。
# 定义在 schemas 层（models/schemas 不得 import services）；这里再导出，既有导入点不变。
from ..schemas.model_window import DEFAULT_CONTEXT_WINDOW, WindowSource  # noqa: E402


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
        "GPT-6.x Astra / Sol / Luna",
        # 官方 2026-11 的旗舰是 gpt-6.2-astra / gpt-6.2-sol / gpt-6-luna（旧写法
        # gpt-6-astra 已不在模型表里，但仍保留匹配，避免老配置掉进 fallback）。
        r"gpt-6(?:[.]\d+)?-(?:astra|sol|luna)(?![a-z0-9])",
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
        "Claude Fable / Mythos / Opus / Sonnet / Haiku 5.x",
        # 5 代（Fable 5.2、Opus 5.5、Sonnet 5.5、Haiku 5.5）统一 1M；
        # 4.5 代仍是 200K，已被上面更具体的规则接走。
        r"claude-(?:fable|mythos|opus|sonnet|haiku)-5(?:[.-]\d+)?(?![0-9])",
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
        # 官方 /models 的 context_window = 1,048,576；Flash 与 V4 Pro 同值。
        1_048_576,
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
        "Qwen Plus（档位别名）",
        # 官方保留的别名，1M 上下文；预设用的就是它，钉版本号反而会漏。
        r"^qwen-plus(?![a-z0-9-])",
        1_000_000,
        "https://help.aliyun.com/zh/model-studio/text-generation-model",
    ),
    WindowRule(
        "Qwen3.5 本地小尺寸（2B–27B / 35B-A3B）",
        # 与云端 Qwen3.5 Plus / Flash（1M）区分：本地开源权重是 256K。
        r"qwen3[.]5[:\-/](?:2b|4b|9b|27b|35b-a3b)(?![a-z0-9])",
        262_144,
        "https://lm-studio.cn/models/qwen/qwen3.5-9b",
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
        "Doubao Seed 2.1（260915 批次）",
        # 同一家族的不同快照窗口不同：260915 是 1024k，260628 是 256k，必须按批次区分。
        r"doubao-seed-2[.-]1-(?:pro|lite)-260915(?![a-z0-9])",
        1_024_000,
        "https://www.volcengine.com/docs/82379/1820188",
    ),
    WindowRule(
        "Doubao Seed 2.1（260628 批次）",
        r"doubao-seed-2[.-]1-(?:pro|turbo)-260628(?![a-z0-9])",
        256_000,
        "https://www.volcengine.com/docs/82379/1820188",
    ),
    WindowRule(
        "腾讯混元 Hy4 / Hy4 flash",
        r"hy4(?:-flash)?(?![a-z0-9])",
        1_000_000,
        "https://cloud.tencent.com/document/product/1222/130051",
    ),
    WindowRule(
        "腾讯混元 Hy3",
        r"hy3(?![a-z0-9])",
        256_000,
        "https://cloud.tencent.com/document/product/1222/130051",
    ),
    WindowRule(
        "文心 ERNIE 5.1 / 4.5 Turbo 128K",
        r"ernie-(?:5[.]\d+|4[.]5-turbo-128k)(?![a-z0-9])",
        128_000,
        "https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j",
    ),
    WindowRule(
        "讯飞星火 X2.6",
        r"spark-x2[.]6(?![a-z0-9])",
        1_000_000,
        "https://xinghuo.xfyun.cn/sparkapi",
    ),
    WindowRule(
        "阶跃 Step 5 Preview",
        r"step-5-preview(?![a-z0-9])",
        1_000_000,
        "https://platform.stepfun.com/docs/zh/guides/models",
    ),
    WindowRule(
        "Mistral Large 4",
        r"mistral-large-4(?![a-z0-9])",
        1_000_000,
        "https://docs.mistral.ai/models/mistral-large-4-0",
    ),
    WindowRule(
        "GPT-OSS 20B / 120B",
        r"gpt-oss(?![a-z0-9])",
        131_072,
        "https://console.groq.com/docs/models",
    ),
    WindowRule(
        "Perplexity Sonar",
        r"(?:^|/)sonar(?![a-z0-9-])",
        128_000,
        "https://docs.perplexity.ai/docs/agent-api/models",
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
