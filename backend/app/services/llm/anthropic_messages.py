# SPDX-License-Identifier: Apache-2.0
"""Anthropic Messages 协议的转换纯函数（从 ``anthropic.py`` 拆出）。

只做结构转换，不碰网络与配置：OpenAI 风格消息 → Messages 协议的
system 拆分、内容块、工具调用/结果转换，以及 **``anthropic-version`` 的分轨判断**。

## 两套协议版本（2026-10-21 迁移）

Anthropic 自 2026-10-21 起移除了 ``temperature`` / ``top_p`` / ``top_k``（发任何一个
都 400），并让新代际模型改用**自适应思考**（``thinking:{"type":"adaptive"}`` +
``output_config.effort``），不再接受 ``budget_tokens``。老代际与第三方兼容网关仍停在
2023-06-01 的形态，所以这里按「host + 模型代际」分两条轨道：

- 官方 ``api.anthropic.com`` + 新代际/未知模型 → ``2026-10-21``；
- 官方老代际、以及**所有**第三方 Anthropic 兼容网关 → ``2023-06-01``（现状逐字段不变）。

官方 host 上不认识的模型按新代际处理：宁可用 adaptive，也不要把已被服务端移除的采样
参数发过去（那必然 400）。第三方网关即便模型名看起来新，也一律走 legacy——它们多数只
实现了 2023-06-01 的形态（见任务书 §4 T10 的硬规则）。
"""
from __future__ import annotations

import json
import re
from typing import Any

from ...schemas.setting import LLMConfig
from .thinking import host_of

# 版本头：老形态（现状）与新形态（2026-10-21 迁移）各一个常量。
ANTHROPIC_VERSION_LEGACY = "2023-06-01"
ANTHROPIC_VERSION_2026 = "2026-10-21"
# 兼容别名：既有导入方（anthropic.py 与测试）仍可按旧名引用 legacy 版本。
ANTHROPIC_VERSION = ANTHROPIC_VERSION_LEGACY

_OFFICIAL_HOST = "api.anthropic.com"

# 新代际（自适应思考）的模型前缀：Claude Opus 4.7/4.8/5、Sonnet 5.x、Haiku 5.5、
# Fable 5.x、Mythos 系列。**只按前缀判断**：官方还会不断加新模型，所以官方 host 上
# 既不匹配这张表、也不匹配老代际表的模型按新代际处理（见 :func:`anthropic_api_version`）。
_ADAPTIVE_MODEL_PATTERN = re.compile(
    r"^claude-(?:opus-(?:4-[78]|5)|sonnet-5|haiku-5-5|fable-5|mythos)"
)
# 已知老代际：仍用 2023-06-01 + 预算式思考。Opus 4.7/4.8 会先被上面的新代际表接走，
# 这里的 ``opus-4`` 实际只兜 4.6 及更早；Haiku 5.5 / Sonnet 5 同理不会误入。
_LEGACY_MODEL_PATTERN = re.compile(r"^claude-(?:instant|2|3|sonnet-4|opus-4|haiku-4)")


def is_adaptive_thinking_model(model: str | None) -> bool:
    """模型是否属于「自适应思考」的新代际（Claude 4.7+/5.x 系）。"""
    return bool(_ADAPTIVE_MODEL_PATTERN.match(str(model or "").strip().casefold()))


def is_known_legacy_model(model: str | None) -> bool:
    """模型是否属于已知的 4.6 及更老代际（仍走 2023-06-01 的预算式思考）。

    先排除新代际：``claude-opus-4-7`` 也匹配 ``opus-4`` 前缀，但它属于自适应思考的
    新代际，两个谓词不能同时为真（"已知老代际"与"已知新代际"互斥）。
    """
    text = str(model or "").strip().casefold()
    if _ADAPTIVE_MODEL_PATTERN.match(text):
        return False
    return bool(_LEGACY_MODEL_PATTERN.match(text))


def anthropic_api_version(config: LLMConfig) -> str:
    """本次请求应使用的 ``anthropic-version``。

    只有「官方 host + 新代际（或官方未收录的新模型）」返回 2026-10-21；官方老代际与
    **所有**第三方 Anthropic 兼容网关一律 legacy——网关多数只实现 2023-06-01 的形态，
    按新协议发过去反而会 400（任务书 §4 T10 的硬规则）。
    """
    if host_of(getattr(config, "base_url", "")) != _OFFICIAL_HOST:
        return ANTHROPIC_VERSION_LEGACY
    model = getattr(config, "model", "") or ""
    if is_adaptive_thinking_model(model) or not is_known_legacy_model(model):
        return ANTHROPIC_VERSION_2026
    return ANTHROPIC_VERSION_LEGACY


def uses_adaptive_thinking(config: LLMConfig) -> bool:
    """本次请求是否走新代际（自适应思考 + 不发采样参数）。"""
    return anthropic_api_version(config) == ANTHROPIC_VERSION_2026


def _data_url_to_image_block(data_url: str) -> dict[str, Any] | None:
    """把 OpenAI 风格的 data URL 图片转成 Anthropic 的 image 内容块。"""
    header, separator, encoded = data_url.partition(",")
    if not separator or not header.startswith("data:") or "base64" not in header:
        return None
    media_type = header[len("data:") :].split(";", 1)[0].strip() or "image/png"
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": encoded},
    }


def _text_from_content(content: Any) -> str:
    """从字符串或块数组里取出纯文本部分。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(block.get("text", ""))
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def _anthropic_content_blocks(content: Any) -> list[dict[str, Any]]:
    """把一条消息的 content 转成 Anthropic 的内容块数组。"""
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    blocks: list[dict[str, Any]] = []
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                blocks.append({"type": "text", "text": str(block.get("text", ""))})
            elif block.get("type") == "image_url":
                url = block.get("image_url", {})
                url_value = url.get("url") if isinstance(url, dict) else None
                converted = _data_url_to_image_block(str(url_value or ""))
                if converted is not None:
                    blocks.append(converted)
    return blocks or [{"type": "text", "text": ""}]


def _has_tool_history(messages: list[dict] | None) -> bool:
    """请求里是否已经带着工具结果——即这是一次"工具轮之后"的后续请求。

    只有多轮工具调用才会让模型在上一轮产出 thinking 块，也就只有这种请求才可能因为
    "没有回传 thinking"被服务端拒绝（见 ``_convert_messages`` 的说明）。用
    ``role == "tool"`` 判定：工具结果只在跑完一轮工具后才出现，是"已经在工具循环里"
    最干净的信号。
    """
    return any(
        str(message.get("role") or "") == "tool" for message in messages or []
    )


def _convert_messages(messages: list[dict]) -> tuple[str, list[dict[str, Any]]]:
    """拆分出 system 文本，并把消息转成 Messages 协议的结构。

    转换的三处差异：
    - ``role: "system"`` 抽出来单独返回（协议要求）；
    - 助手消息里的 ``tool_calls`` → ``tool_use`` 内容块；
    - ``role: "tool"`` 的结果 → 紧随其后的 user 消息里的 ``tool_result`` 块
      （协议要求工具结果由 user 角色承载）。

    **已知限制：不回传 extended thinking 的 thinking 块。** 官方要求：开启 extended
    thinking 且发生**多轮工具调用**时，上一轮助手消息里的 thinking 块（连同它的
    signature）必须**原样**拼回下一轮请求，否则服务端会以 400 拒绝后续请求。本实现
    没有保存、也没有回传 thinking 块，因此这一种组合会受影响：

    - **受影响场景**：原生 Anthropic（``AnthropicProvider``）+ 开启思考 + 一次回答里
      触发工具调用、且模型在工具调用之后还需要再答一轮（多轮工具）。
    - **用户看到什么**：第二轮请求失败，界面上出现"请求格式错误：本轮是「原生 Anthropic
      接口 + 思考强度 + 工具调用」的组合……"（指向真因的专属提示，见 ``_http_error``），
      那一轮回答中断（已产出的思考与正文保留）。
    - **不受影响**：不开思考；开了思考但一轮就给出最终回答（无工具，或工具后直接结束）。

    之所以选择记录而不是现在实现回传：回传要求把 thinking 文本与 signature 一起保存
    并正确拼回消息序列，而思考内容当前**刻意不回灌给模型**（见 ``assistant_stream``），
    两者是一套改动。先如实记录，避免留下"看起来支持、少数场景才炸"的假象。
    """
    system_parts: list[str] = []
    converted: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        if role == "system":
            text = _text_from_content(message.get("content"))
            if text.strip():
                system_parts.append(text)
            continue
        if role == "tool":
            block = {
                "type": "tool_result",
                "tool_use_id": str(message.get("tool_call_id") or ""),
                "content": _text_from_content(message.get("content")),
            }
            # 工具结果可能连续多条，合并进同一条 user 消息。
            if converted and converted[-1]["role"] == "user" and converted[-1].get("_tool_results"):
                converted[-1]["content"].append(block)
                continue
            converted.append({"role": "user", "content": [block], "_tool_results": True})
            continue

        blocks = _anthropic_content_blocks(message.get("content"))
        tool_calls = message.get("tool_calls")
        if isinstance(tool_calls, list):
            for call in tool_calls:
                function = (call or {}).get("function") or {}
                raw_arguments = function.get("arguments") or "{}"
                try:
                    parsed = json.loads(raw_arguments)
                except (TypeError, ValueError):
                    parsed = {}
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": str(call.get("id") or ""),
                        "name": str(function.get("name") or ""),
                        "input": parsed if isinstance(parsed, dict) else {},
                    }
                )
        converted.append(
            {"role": "assistant" if role == "assistant" else "user", "content": blocks}
        )

    # 去掉内部标记，协议里没有这个字段。
    for message in converted:
        message.pop("_tool_results", None)
    return "\n\n".join(system_parts), converted


def _convert_tools(tools: list[dict] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    converted: list[dict[str, Any]] = []
    for tool in tools:
        function = (tool or {}).get("function") or {}
        name = str(function.get("name") or "")
        if not name:
            continue
        converted.append(
            {
                "name": name,
                "description": str(function.get("description") or ""),
                "input_schema": function.get("parameters")
                or {"type": "object", "properties": {}},
            }
        )
    return converted or None

