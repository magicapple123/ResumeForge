# SPDX-License-Identifier: Apache-2.0
"""思考参数能力表（**国外三家 + 网关 + 托管与本地**）：字段语义见 ``thinking_vendors.py``。

与 ``thinking_vendor_rules_cn.py`` 是同一条表的两半：两张表**主机互不重叠**，所以拼接
顺序不影响匹配结果（先匹配先赢只在同一主机的多条规则之间有意义）。
"""

from __future__ import annotations

import re

from .thinking_vendors import (
    ALL_MODELS,
    STYLE_REASONING_EFFORT,
    VendorRule,
)

GLOBAL_RULES: tuple[VendorRule, ...] = (
    # ---------- OpenAI 系 ----------
    VendorRule(
        "api.openai.com",
        # 预设自 2026-11-08 起用 gpt-6-astra，所以这条要同时覆盖 5.2+ 与 6 代：
        # 只写 ^gpt-5 会让预设模型掉进「未收录」，设置页给不出一句可用的档位说明。
        re.compile(r"^gpt-6|^gpt-5\.[2-9]|^gpt-5\.\d\d"),
        STYLE_REASONING_EFFORT,
        ("none", "low", "medium", "high", "xhigh"),
        True,
        "GPT-5.2 及以后（含 GPT-6 代）用 reasoning_effort 分档（含 none 与 xhigh），且**省略"
        "即 medium**（A：官方指南）。注意 GPT-6 Astra 与 GPT-6.1 Sol 不支持 none。",
        default_on=True,
        disable_chat={"reasoning_effort": "none"},
        disable_responses={"reasoning": {"effort": "none"}},
        # A：官方原文 —— Astra 发 none 返 400；Sol 连 minimal 都不支持。
        cannot_disable=(re.compile(r"^gpt-6-astra"), re.compile(r"^gpt-6\.1-sol")),
    ),
    VendorRule(
        "api.openai.com",
        re.compile(r"^gpt-5(\.[01])?(-(mini|nano))?$"),
        STYLE_REASONING_EFFORT,
        ("minimal", "low", "medium", "high"),
        True,
        "GPT-5 / 5.1 代用 reasoning_effort：minimal/low/medium/high，**没有 none 档**——最低"
        "只能到 minimal，无法完全关闭（B）；本应用不会给它们发关闭参数（发了 none 会 400）。",
        default_on=True,
        disable_chat={},
        disable_responses={},
        cannot_disable=(re.compile(r"^gpt-5(\.[01])?(-(mini|nano))?$"),),
    ),
    VendorRule(
        "api.openai.com",
        re.compile(r"^o[1-9]"),
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "o 系列推理模型用 reasoning_effort：low/medium/high，没有 none 档、无法关闭（B）；"
        "该系列正被 GPT-5 取代。",
        default_on=True,
        disable_chat={},
        disable_responses={},
        cannot_disable=(ALL_MODELS,),
    ),
    VendorRule(
        "api.openai.com",
        re.compile(r"^(gpt-4|gpt-3|chatgpt)"),
        STYLE_REASONING_EFFORT,
        (),
        False,
        "gpt-4 这代不是推理模型（且已陆续下线），开了也不会有思考内容。",
    ),
    VendorRule(
        "openai.azure.com",
        None,
        STYLE_REASONING_EFFORT,
        ("minimal", "low", "medium", "high"),
        True,
        "Azure OpenAI（v1 接口）与 OpenAI 同形；官方页对 temperature/top_p 是否支持自相矛盾，"
        "o1-mini 也不支持 reasoning_effort（D）。未实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
    VendorRule(
        "openrouter.ai",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "OpenRouter 会把 reasoning_effort 归一化后转给具体模型；上游标 mandatory 时**禁止**发 "
        "none（Bedrock 上游接受但静默忽略）（B）。未逐模型实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
    # ---------- 国产二线里的国外厂商 / 托管与本地 ----------
    VendorRule(
        "api.x.ai",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "xAI：只有 grok-4.3 能关闭思考（reasoning_effort 取 none，默认 low）；4.5 及以后**不可"
        "关闭**（默认 high）（B）。官方已废弃 Anthropic 兼容，迁移到 Responses。",
        default_on=True,
        disable_chat={"reasoning_effort": "none"},
        disable_responses={"reasoning": {"effort": "none"}},
        cannot_disable=(re.compile(r"^grok-4\.[5-9]"), re.compile(r"^grok-[5-9]")),
    ),
    VendorRule(
        "api.mistral.ai",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "Mistral 的 reasoning_effort 取 none 表示「最少思考」而非零思考，large-4-0 不接受 none（B）；"
        "官方未写省略时的默认值，未实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        cannot_disable=(re.compile(r"^mistral-large-4"),),
    ),
    VendorRule(
        "api.groq.com",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "Groq：reasoning_effort 取 none 只有 Qwen3.8 支持；GPT-OSS / Muse **恒思考**，"
        "reasoning_format 取 hidden 只隐藏不关闭（B）。未实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        cannot_disable=(re.compile(r"gpt-oss"), re.compile(r"muse")),
    ),
    VendorRule(
        "api.together.ai",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "Together AI：关闭写法是 reasoning:{enabled:false}（仅 hybrid 型号），GPT-OSS 明确"
        "无法完全关闭（B）；未实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        cannot_disable=(re.compile(r"glm-5\.3"),),
    ),
    VendorRule(
        "api.together.xyz",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "Together AI（旧域名）：关闭写法与 api.together.ai 同一条口径；未实测，按保守方案"
        "不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        cannot_disable=(re.compile(r"glm-5\.3"),),
    ),
    VendorRule(
        "api.perplexity.ai",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "Perplexity：Orchestrator 有 none 枚举，但没有「=关闭」的官方原文（C），旧 Sonar 已退役；"
        "未识别顶层字段会直接 400（B）。未实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
    VendorRule(
        "generativelanguage.googleapis.com",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "Gemini 只有 low/medium/high、**没有 none**；原生 thinkingBudget:0 仅 2.5 Flash/Lite 可用"
        "（3.x 起弃用、4.x 传了直接 400）（B/C）。未实测（ai.google.dev 不可达，引 Vertex 文档），"
        "按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        cannot_disable=(ALL_MODELS,),
    ),
    VendorRule(
        "localhost",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "本机端点（Ollama / LM Studio）：Ollama 的 /v1 认 reasoning_effort、原生 /api/chat 认 "
        "think:false（两个字段作用域不同，不能互发）；LM Studio 官方参数表没有 reasoning_effort"
        "（D）。无法从主机名区分运行时，未实测，按保守方案不发送关闭参数（思考默认值取决于"
        "模型 metadata）。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
    VendorRule(
        "127.0.0.1",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "本机端点（Ollama / LM Studio）：与 localhost 同一条口径，未实测，按保守方案不发送"
        "关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
)
