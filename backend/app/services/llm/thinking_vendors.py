# SPDX-License-Identifier: Apache-2.0
"""思考参数能力表：按「主机后缀 + 型号名正则」给出形态、默认是否思考、以及关闭写法。

## 为什么单独一个模块

2026-11-09 第 11 条审计后，表从 8 个主机补到 22 个预设与它们的托管型号（清单 §11.2）：
数据量已经超过判断逻辑本身，而 ``thinking.py`` 当时 457/500 行，继续堆会顶穿单文件
预算。**拆法只搬数据不搬判断**——形态解析、请求体片段、实测探测仍在 ``thinking.py``，
对外 API 与 provider 都不感知这次拆分。

## 证据等级（清单 §11.1）

- **A**：本机实测或逐字复核官方页面（本批：DeepSeek Responses 的 ``reasoning.effort=none``，
  实测 reasoning_tokens=0）。
- **B**：官方文档原文（本批多数主机）。
- **C**：官方页面存在但字段表缺席（"缺席证据"）。
- **D**：未查到 / 仅二手。

**没有凭据的厂商一律按保守方案**（清单 §11.7）：宁可不发关闭参数（最多是"没关掉"），
也不发一个可能被 400 拒绝的参数（那会把"慢"变成"直接失败"）。这类主机在 ``note`` 里
写明「未实测，按保守方案」，**不把推断写成实测结论**。

## 三个字段的分工

- ``style`` / ``efforts`` / ``supported`` / ``note``：设置页给什么选项、怎么解释；
- ``default_on``：该端点**不指定就思考**。关着时必须显式发一次关闭参数，否则界面写着
  "关闭"、实际还在思考（第 10 条实测 28.5k 输出 tokens 的根因）；
- ``disable_chat`` / ``disable_responses`` / ``cannot_disable``：**怎么关**。chat 与
  responses 的写法不同是事实：同一个 DeepSeek，chat 收 ``thinking:{type:disabled}``，
  responses 只认 ``reasoning:{effort:none}``（清单 §10.3 的 B 行证明前者在 /responses 上无效）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

STYLE_AUTO = "auto"
STYLE_REASONING_EFFORT = "reasoning_effort"
STYLE_THINKING_OBJECT = "thinking_object"
STYLE_ENABLE_THINKING = "enable_thinking"
STYLE_BUDGET = "budget"

# 关闭思考时**按协议**分流的两个取值。原生 Messages（anthropic）不在本表里：它的两代
# 写法（预算 / 自适应 effort）由 ``anthropic.py`` 自己决定，混进来会把两条链路缠死。
PROTOCOL_CHAT = "chat"
PROTOCOL_RESPONSES = "responses"

# 命中任何型号的正则：表达"该端点对任何型号都不可控"（没有关闭入口 / 强制思考）。
# 公开成 ALL_MODELS 是因为两张数据表都要引用它（私有名跨模块引用反而更糟）。
ALL_MODELS = re.compile("")


def host_of(base_url: str) -> str:
    """从 Base URL 取小写主机名；非法地址返回空串。

    （RF-14 §2.3：从私有 ``_host_of`` 提取为可复用纯函数，供 capabilities 的能力表
    做同构匹配；行为零变化。）
    """
    try:
        return (urlsplit(str(base_url or "")).hostname or "").casefold()
    except ValueError:
        return ""


@dataclass(frozen=True)
class VendorRule:
    """一条能力表规则：主机后缀匹配 + 模型名正则（空 = 不限）。**先匹配先赢**。"""

    host: str
    model_pattern: re.Pattern[str] | None
    style: str
    efforts: tuple[str, ...]
    supported: bool
    note: str
    # 该模型**不指定就思考**（DeepSeek、通义、智谱、豆包、OpenAI……）。这时"关"不能靠
    # 省略表达——省略等于沿用服务商默认，界面写着"关闭"、实际还在思考。
    default_on: bool = False
    # 关闭参数：按协议区分。None = 回退（chat 按 style 反推，responses 视为没有关闭入口）；
    # {} = 该协议明确没有关闭入口。**不要**把 chat 的 thinking 对象照抄到 responses 上。
    disable_chat: dict[str, Any] | None = None
    disable_responses: dict[str, Any] | None = None
    # 不可关闭思考的型号（正则白名单）。命中即**一个字都不发**：这些型号强制思考，传
    # none/disabled 会被上游 400（清单 §11.3：GPT-6 Astra、GPT-6.1 Sol、GLM-5.3、
    # Kimi K3、MiniMax M3.1-Flash）。设置页据 supported=False 把它置灰并说明原因。
    cannot_disable: tuple[re.Pattern[str], ...] = ()

    def cannot_disable_model(self, model: str) -> bool:
        """该型号是否强制思考（大小写不敏感；空 model 视为不命中）。"""
        normalized = str(model or "").strip().casefold()
        return any(pattern.search(normalized) for pattern in self.cannot_disable)

    def support_note(self, model: str) -> str:
        """给设置页的一句话解释；命中强制思考型号时追加原因（不清空原有说明）。"""
        if not self.cannot_disable_model(model):
            return self.note
        return (
            self.note + " 该型号强制思考：关闭参数会被上游拒绝（或根本没有关闭入口），"
            "本应用不会发送。"
        )


# 「不可关闭思考」的型号清单（清单 §11.3 的 A/B 级证据）。它是**第二处事实**，刻意不
# 从 cannot_disable 正则里反推：这里带显示名，设置页的协议矩阵表尾文案必须与它逐字一致
# （守卫：backend/tests/test_llm_thinking_disable.py 会读前端语言包比对），新增一个强制
# 思考型号必须同时改这里、对应主机规则与矩阵文案三处。example_* 让守卫能构造真实配置对拍。
FORCED_THINKING_MODELS: tuple[tuple[str, str, str], ...] = (
    ("GPT-6 Astra", "https://api.openai.com/v1", "gpt-6-astra"),
    ("GPT-6.1 Sol", "https://api.openai.com/v1", "gpt-6.1-sol"),
    ("GLM-5.3", "https://open.bigmodel.cn/api/paas/v4", "glm-5.3"),
    ("Kimi K3", "https://api.moonshot.cn/v1", "kimi-k3"),
    ("MiniMax M3.1-Flash", "https://api.minimaxi.com/v1", "MiniMax-M3.1-Flash"),
)


def disable_payload_for_style(style: str) -> dict:
    """按「开启形态」反向推出的关闭片段；没有反向写法时返回空 dict。

    ``reasoning_effort`` 形态**不反推**：顶层 ``reasoning_effort:"none"`` 只对部分
    服务商/型号成立（GPT-6 Astra 传 none 直接 400），必须由表逐条写明。
    """
    if style == STYLE_THINKING_OBJECT:
        return {"thinking": {"type": "disabled"}}
    if style == STYLE_ENABLE_THINKING:
        return {"enable_thinking": False}
    return {}


__all__ = [
    "ALL_MODELS",
    "FORCED_THINKING_MODELS",
    "PROTOCOL_CHAT",
    "PROTOCOL_RESPONSES",
    "STYLE_AUTO",
    "STYLE_BUDGET",
    "STYLE_ENABLE_THINKING",
    "STYLE_REASONING_EFFORT",
    "STYLE_THINKING_OBJECT",
    "VendorRule",
    "disable_payload_for_style",
    "host_of",
]
