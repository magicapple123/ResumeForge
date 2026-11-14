# SPDX-License-Identifier: Apache-2.0
"""上下文用量分桶（需求 #6）：把"这一轮真正发给模型的上下文"按**构造**拆成五个桶。

为什么"按构造"而不是解析最终 ``messages``：五段在最终请求里是混在一起的（技能拼进
system，项目上下文与附件文本拼进当前 user 消息，工具结果是一条条 ``role=tool``）——
事后切字符串必然算错，而且提示词一改就会静默漂移。所以各调用方把**输入部件**交进来，
本模块只做纯计算。

本模块刻意**不碰 DB、不碰网络、不碰 settings**：估算口径由 ``llm.token_estimate``
单一提供（那是仓库里唯一的估算实现），窗口分母与实测 token 由调用方取好传进来。
这样它可以在毫秒级单测里覆盖全部分支，也让"估算值禁止用于计费/截断"这条既有立场
继续只存在于一处注释里。

**估算 vs 实测不合并**：``total``/``percent``/各桶全部来自 ``estimate_tokens``；
``usage_actual`` 是服务商上一轮真正报告的 ``prompt_tokens``，原样透传，不做任何换算。
"""

from __future__ import annotations

import json
import math
from typing import Any

from ..llm.token_estimate import estimate_tokens

# 固定五项、固定顺序——前端图例与五段条按这个顺序渲染，后端不得动态增删。
BUCKET_KEYS: tuple[str, ...] = ("system", "tools", "conversation", "connectors", "skills")

# 百分比保留 1 位小数（前端显示 ``25.9%``）；0.1 的粒度也是"五桶之和 == 总占比"的网格。
_PERCENT_STEP = 10


def _consistent_percents(tokens_list: list[int], window_tokens: int) -> tuple[list[float], float]:
    """五个桶的占比 + 总占比，四舍五入到 0.1 且**五桶之和恒等于总占比**（最大余额法）。

    朴素做法是各自 ``round(x, 1)``：五个桶的舍入误差最多累积 ±0.25，再叠加总占比
    自己的 ±0.05，最坏能差 0.3——比"五行相加 = 顶部总占比"这条产品口径（≤0.2）宽。
    这里先把总数定死（``round(total/window*100, 1)``），再把小数余量按余额大小逐格
    补给各桶，于是"相加对得上"和"单桶误差 ≤0.1"同时成立。总占比与原值同口径
    （都是 ``total/window*100`` 保留 1 位）。
    """
    exact = [tokens / window_tokens * 100 for tokens in tokens_list]
    total_scaled = round(sum(exact) * _PERCENT_STEP)
    floors = [math.floor(value * _PERCENT_STEP) for value in exact]
    remainder = total_scaled - sum(floors)
    # 余量理论上落在 [0, 桶数]；夹一下，避免浮点边界把长度算出负数。
    remainder = max(0, min(len(exact), remainder))
    order = sorted(
        range(len(exact)),
        key=lambda index: (exact[index] * _PERCENT_STEP) - floors[index],
        reverse=True,
    )
    units = list(floors)
    for index in order[:remainder]:
        units[index] += 1
    return [unit / _PERCENT_STEP for unit in units], total_scaled / _PERCENT_STEP


def build_context_usage(
    parts: dict[str, str],
    *,
    window_tokens: int,
    usage_actual: int | None = None,
    partial: bool = False,
) -> dict[str, Any]:
    """把五段原始文本折算成前端契约的用量载荷。

    Args:
        parts: 五个桶的**原始文本**；缺失键按空串处理（空文本 = 0 token）。
        window_tokens: 当前模型的上下文窗口；``0`` = 用户没设置（不算占比）。
        usage_actual: 上一轮服务商实测的 ``prompt_tokens``；``None`` = 未报告。
        partial: 是否为"旧消息估算出来的部分数据"（只有 system 与 conversation 可信）。

    Returns:
        ``{"buckets": [{"key", "tokens", "percent"}, ...], "total", "window",
        "percent", "partial", "usage_actual"}``——字段名即前端契约，不要改名。
    """
    tokens_list = [estimate_tokens(str(parts.get(key) or "")) for key in BUCKET_KEYS]
    total = sum(tokens_list)
    percent: float | None
    if window_tokens > 0:
        percents, percent = _consistent_percents(tokens_list, window_tokens)
    else:
        # 没有分母：不算占比且**返回 None 而不是 0**——0% 会被读成"一点都没用"，
        # 而事实是"用户没填窗口，算不出来"。总占比同理。
        percents = [None] * len(BUCKET_KEYS)
        percent = None
    buckets = [
        {"key": key, "tokens": tokens, "percent": bucket_percent}
        for key, tokens, bucket_percent in zip(BUCKET_KEYS, tokens_list, percents, strict=True)
    ]
    return {
        "buckets": buckets,
        "total": total,
        "window": window_tokens,
        "percent": percent,
        "partial": partial,
        "usage_actual": usage_actual,
    }


def message_text(content: Any) -> str:
    """把一条消息的 ``content`` 取出可估算的纯文本。

    助手消息的 content 可能是字符串，也可能是内容块列表（当前 user 消息带图片时就是
    后者）。图片块没有可估算的文本，跳过即可——它的 data URL 长度与 token 无关。
    """
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    texts: list[str] = []
    for block in content:
        if isinstance(block, str):
            texts.append(block)
        elif isinstance(block, dict) and isinstance(block.get("text"), str):
            texts.append(block["text"])
    return "\n".join(texts)


def conversation_text(messages: list[dict[str, Any]]) -> str:
    """对话消息桶：历史各条（user / assistant）正文的拼接。

    ``role == "tool"`` 的条目**不计入这里**——它们属于"工具及子智能体"桶；
    ``role == "system"`` 不计入——它属于系统提示词桶。按构造分桶，不靠字符串切分。
    """
    return "\n\n".join(
        message_text(message.get("content"))
        for message in messages
        if message.get("role") in {"user", "assistant"}
    )


def tools_text(tools: Any, messages: list[dict[str, Any]]) -> str:
    """工具定义与结果桶：本轮工具 schema + 已经回填进 messages 的工具结果。

    ``json.dumps(tools)`` 在这里按"一次调用 = 一轮"的粒度做：同一轮里 schema 不变，
    调用方每轮算一次并复用，绝不在每个 delta 里重算（工具 schema 是上下文中最大的
    单个静态块）。
    """
    schema = "" if tools is None else json.dumps(tools, ensure_ascii=False)
    tool_results = "\n\n".join(
        message_text(message.get("content"))
        for message in messages
        if message.get("role") == "tool"
    )
    return "\n\n".join(part for part in (schema, tool_results) if part)


def attachment_text(attachments: list[dict[str, Any]] | None) -> str:
    """附件文本（文档/文本附件在本地已抽取成字符串）；没有可读文本时返回空串。"""
    texts = [
        str(item.get("text"))
        for item in attachments or []
        if isinstance(item, dict) and item.get("text")
    ]
    return "\n\n".join(texts)


def connectors_text(
    client_block: str,
    model_context: list[str],
    attachments: list[dict[str, Any]] | None,
) -> str:
    """界面上下文与附件桶 = 界面上下文块 + 项目上下文块 + 附件文本（空部件跳过）。

    这三样在最终 ``messages`` 里都拼进了当前 user 消息，事后切字符串分不出来；按构造
    分别取数才说得清"这段是连接器带的资料，不是用户打的字"。
    """
    return "\n\n".join(
        part
        for part in (client_block, "\n\n".join(model_context), attachment_text(attachments))
        if part
    )


def turn_usage(
    *,
    prompt_parts: dict[str, str],
    connectors_source: str,
    conversation_source: str,
    tools: Any,
    messages: list[dict[str, Any]],
    window_tokens: int,
    usage_actual: int | None,
) -> dict[str, Any]:
    """一轮的用量：把调用方按构造取好的部件装进五桶，再折算成前端契约。

    这个装配放在本模块而不是流编排里，是为了让"哪个部件进哪个桶"与 `BUCKET_KEYS`
    同处一文件——流那边只负责取数（`prompt_parts` / 项目上下文 / 历史 / 本轮 tools），
    桶的边界一旦要调，改一处即可。
    """
    return build_context_usage(
        {
            "system": prompt_parts.get("base", ""),
            "skills": prompt_parts.get("skills", ""),
            "connectors": connectors_source,
            "conversation": conversation_source,
            # 工具 schema + 已回填的工具结果（同一轮里 schema 不变，按轮算一次）。
            "tools": tools_text(tools, messages),
        },
        window_tokens=window_tokens,
        usage_actual=usage_actual,
    )


__all__ = [
    "BUCKET_KEYS",
    "attachment_text",
    "build_context_usage",
    "connectors_text",
    "conversation_text",
    "message_text",
    "tools_text",
    "turn_usage",
]
