# SPDX-License-Identifier: Apache-2.0
"""思考参数能力表（**国产与国内托管**）：主机 + 型号 → 形态 / 默认是否思考 / 关闭写法。

从 ``thinking_vendors.py`` 再拆出来的一块纯数据（2026-11-09 第 11 条）。字段语义、
证据等级（A/B/C/D）与「没有凭据一律保守」的策略只写在 ``thinking_vendors.py`` 的模块
docstring 里，这里不重复解释，免得两处漂移。

**改规则时同时看**：``thinking_vendor_rules_global.py``（国外与本地端点）、
``thinking_vendors.FORCED_THINKING_MODELS``（强制思考型号清单，前端协议矩阵文案与它同源）、
以及设置页矩阵 ``frontend/src/components/settings/LLMProtocolSupportMatrix.tsx``。
"""

from __future__ import annotations

import re

from .thinking_vendors import (
    ALL_MODELS,
    STYLE_ENABLE_THINKING,
    STYLE_REASONING_EFFORT,
    STYLE_THINKING_OBJECT,
    VendorRule,
)

DOMESTIC_RULES: tuple[VendorRule, ...] = (
    # ---------- 国产主力 ----------
    VendorRule(
        "open.bigmodel.cn",
        re.compile(r"^glm-(4\.[5-9]|5)"),
        STYLE_THINKING_OBJECT,
        (),
        True,
        "GLM-4.5 及以上用 thinking 开关控制思考，且默认开着（B）。",
        default_on=True,
        disable_responses={"reasoning": {"effort": "none"}},
        # GLM-5.3 / 5.3-FLASH 强制思考，传 disabled 直接报错（A：页面原文）。
        cannot_disable=(re.compile(r"^glm-5\.3"),),
    ),
    VendorRule(
        "dashscope.aliyuncs.com",
        # 匹配 `^qwen` 而不是 `^qwen3`：预设里用的是官方长期保留的档位别名 `qwen-plus`，
        # 钉版本号会让它掉进"未收录"。该主机上也会托管别家的模型，所以不能按主机一刀切。
        re.compile(r"^qwen"),
        STYLE_ENABLE_THINKING,
        (),
        True,
        "通义 Qwen3.5 及以上的混合模型**默认就思考**：不想思考要显式关掉（本应用会在"
        "「思考模式」关闭时替你发关闭参数）。qwen3.8 起也支持 reasoning_effort 分档。",
        default_on=True,
        disable_responses={"reasoning": {"effort": "none"}},
    ),
    VendorRule(
        "dashscope.aliyuncs.com",
        re.compile(r"^(glm-5\.3|kimi-k3)"),
        STYLE_THINKING_OBJECT,
        (),
        False,
        "百炼（DashScope）上托管的 GLM-5.3 / Kimi K3 系同样是强制思考的型号，没有可靠的"
        "关闭写法；本应用不会给它们发关闭参数（未实测，按保守方案）。",
        default_on=True,
        disable_chat={},
        disable_responses={},
        cannot_disable=(ALL_MODELS,),
    ),
    VendorRule(
        "api.deepseek.com",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "DeepSeek（deepseek-flash / deepseek-v4-pro）用 thinking 开关控制思考，且**默认开着**"
        "（A：Chat Completions 用 thinking:{type:disabled}，Responses 用 reasoning.effort=none，"
        "后者实测 reasoning_tokens=0）。",
        default_on=True,
        # Responses 上唯一**实测有效**的关闭写法（清单 §10.3 C 行）。
        disable_responses={"reasoning": {"effort": "none"}},
    ),
    VendorRule(
        "api.minimax",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "MiniMax（M3 / M3.1）用 thinking 开关控制思考，且默认思考（B/C）；M3.1-Flash 强制"
        "思考，传 disabled 返回 400。Responses 的关闭写法官方未给字段表（C），按保守方案不发送。",
        default_on=True,
        disable_responses={},
        cannot_disable=(re.compile(r"m3\.1-flash"),),
    ),
    VendorRule(
        "api.moonshot",
        re.compile(r"^kimi-k3"),
        STYLE_THINKING_OBJECT,
        (),
        False,
        "kimi-k3 的思考是常开的，没有关闭参数——这里的「思考模式」对它不起作用（清单 §11.3 B）。",
        default_on=True,
        disable_chat={},
        disable_responses={},
        cannot_disable=(ALL_MODELS,),
    ),
    VendorRule(
        "api.moonshot",
        re.compile(r"^kimi-k2"),
        STYLE_THINKING_OBJECT,
        (),
        True,
        "kimi-k2.6 / k2.5 可以用 thinking:{type:disabled} 关闭，且默认思考（B）；Responses "
        "只挂 K3 系、没有关闭入口，按保守方案不发送。",
        default_on=True,
        disable_responses={},
    ),
    VendorRule(
        # TokenHub 与境外入口共用这个后缀（tokenhub.tencentmaas.com / tokenhub-intl…）。
        "tencentmaas.com",
        None,
        STYLE_REASONING_EFFORT,
        ("no_think", "low", "high"),
        False,
        "腾讯混元已迁到 TokenHub：官方文档给出 reasoning_effort 三档 no_think/low/high（B），"
        "但 Responses 与关闭行为未实测，按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
    VendorRule(
        "api.hunyuan.cloud.tencent.com",
        None,
        STYLE_REASONING_EFFORT,
        (),
        False,
        "混元旧域名没有 thinking/思考字段，靠型号区分 thinking 与 instruct（B）；官方公告说能力"
        "已迁到 TokenHub。未实测，按保守方案不发送思考参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
    ),
    VendorRule(
        "ark.cn-beijing.volces.com",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "豆包/方舟用 thinking 开关控制思考、默认思考（B）；思考下 stop 不生效。官方在 Responses "
        "上主推的关闭写法仍是 thinking:{type:disabled}（不是 reasoning.effort）。",
        default_on=True,
        disable_responses={"thinking": {"type": "disabled"}},
        # 方舟上托管的 GLM-5.3 / Kimi K3 系同样不可关闭（B）。
        cannot_disable=(re.compile(r"glm-5[.-]3"), re.compile(r"kimi-k3")),
    ),
    VendorRule(
        "api.siliconflow.cn",
        None,
        STYLE_ENABLE_THINKING,
        (),
        True,
        "硅基流动用**顶层布尔** enable_thinking:false 关闭，官方没有 thinking 对象（B）；"
        "只对官方 13 个型号白名单生效，R1 / K2-Thinking / Qwen3-Thinking 系关不掉。"
        "未实测，按官方文档原文。",
        default_on=True,
        disable_responses={},
        cannot_disable=(
            re.compile(r"deepseek-r1|(^|/)r1"),
            re.compile(r"k2-thinking"),
            re.compile(r"qwen3-thinking"),
        ),
    ),
    VendorRule(
        "qianfan.baidubce.com",
        None,
        STYLE_ENABLE_THINKING,
        (),
        True,
        "百度千帆默认**不思考**（thinking 默认 disabled / enable_thinking 默认 false，B）；"
        "开着时用 enable_thinking:true。Responses 与 Anthropic 入口官方已提供，但思考字段表"
        "未查到（C），按保守方案不发送关闭参数。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        # 官方标注 glm-5.3 / 5.3-flash「仅支持开启」（B）。
        cannot_disable=(re.compile(r"^glm-5\.3"),),
    ),
    VendorRule(
        "maas-api.cn-huabei-1.xf-yun.com",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "讯飞星火新 MaaS 平台：思考**默认开启**，Chat Completions 用 thinking:{type:disabled} "
        "关闭，Responses 用 reasoning:{effort:none}（B）；Anthropic/Responses 入口都在这台主机上。"
        "未实测，按官方文档原文。",
        default_on=True,
        disable_responses={"reasoning": {"effort": "none"}},
    ),
    VendorRule(
        "spark-api-open.xf-yun.com",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "讯飞星火**旧**域名只有 Chat Completions（Anthropic/Responses 在 maas-api 域名，见协议"
        "矩阵）；思考默认开启、关闭用 thinking:{type:disabled}（B）。未实测，按官方文档原文。",
        default_on=True,
        disable_responses={},
    ),
    VendorRule(
        "api.stepfun.com",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        False,
        "阶跃星辰只有 reasoning_effort 三档、**没有关闭入口**（B），官方也没写省略时的默认值；"
        "本应用不发送关闭参数（未实测，按保守方案）。",
        default_on=False,
        disable_chat={},
        disable_responses={},
        cannot_disable=(ALL_MODELS,),
    ),
    # ---------- 国内托管 / 二线 ----------
)
