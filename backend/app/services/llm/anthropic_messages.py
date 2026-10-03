"""Anthropic Messages 协议的转换纯函数（从 ``anthropic.py`` 拆出）。

只做结构转换，不碰网络与配置：OpenAI 风格消息 → Messages 协议的
system 拆分、内容块、工具调用/结果转换，以及 ``ANTHROPIC_VERSION``。
"""
from __future__ import annotations

import json
from typing import Any


ANTHROPIC_VERSION = "2023-06-01"


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
    for message in messages or []:
        if str(message.get("role") or "") == "tool":
            return True
    return False


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

