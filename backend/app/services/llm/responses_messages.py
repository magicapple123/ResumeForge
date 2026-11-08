# SPDX-License-Identifier: Apache-2.0
"""OpenAI Responses 协议的**纯转换函数**（从 openai_compat 的形态映射过来）。

Responses 与 Chat Completions 的结构差异（任务书 §4 T09 的表）：

- 请求体：messages → input items（本条消息 + 工具调用是**同级的 item**，不是嵌在消息里）；
- 工具：{type:function, function:{...}} → 扁平 {type:function, name, description, parameters}；
- 图片：image_url 块 → input_image（只允许出现在 user/developer 消息里）；
- 工具结果：role:"tool" → function_call_output，call_id 配对。

本模块只做结构转换，不碰网络、配置与流式解析。
"""

from __future__ import annotations

from typing import Any


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


def _image_url(block: dict) -> str | None:
    """从 OpenAI 风格的 image_url 块里取出 URL（兼容对象与字符串两种写法）。"""
    value = block.get("image_url")
    if isinstance(value, dict):
        value = value.get("url")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _input_blocks(content: Any) -> list[dict[str, Any]]:
    """把一条 user 消息的 content 转成 Responses 的输入内容块。

    只保留文本与图片：其它形态（例如历史遗留的 tool_result 块）忽略——工具结果走
    function_call_output，不是消息内容。
    """
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    blocks: list[dict[str, Any]] = []
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                blocks.append({"type": "input_text", "text": str(block.get("text", ""))})
            elif block.get("type") == "image_url":
                url = _image_url(block)
                if url is not None:
                    blocks.append({"type": "input_image", "image_url": url})
    return blocks


def _assistant_text_item(text: str) -> dict[str, Any]:
    return {"role": "assistant", "content": [{"type": "output_text", "text": text}]}


def convert_messages(messages: list[dict]) -> list[dict[str, Any]]:
    """OpenAI 风格消息 → Responses 的 input items（保持原顺序）。

    三条硬约束（任务书 §4 T09 风险项）：

    1. assistant 的 tool_calls 变成与消息同级的 function_call item，**排在**
       紧跟其后的 function_call_output 之前（输出顺序由原消息顺序天然保证）；
    2. function_call_output 的 call_id 必须与 function_call 的 call_id 配对；
    3. 图片只允许出现在 user 消息里，system/assistant 里的图片块直接丢弃
       （转发过去会被服务端 400 拒绝）。
    """
    items: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = message.get("content")
        if role == "system":
            text = _text_from_content(content)
            if text.strip():
                items.append({"role": "system", "content": [{"type": "input_text", "text": text}]})
            continue
        if role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": str(message.get("tool_call_id") or ""),
                    "output": _text_from_content(content),
                }
            )
            continue
        if role == "assistant":
            text = _text_from_content(content)
            if text.strip():
                items.append(_assistant_text_item(text))
            tool_calls = message.get("tool_calls")
            if isinstance(tool_calls, list):
                for call in tool_calls:
                    if not isinstance(call, dict):
                        continue
                    function = (call.get("function") or {}) if isinstance(call, dict) else {}
                    items.append(
                        {
                            "type": "function_call",
                            "call_id": str(call.get("id") or ""),
                            "name": str(function.get("name") or ""),
                            "arguments": str(function.get("arguments") or "{}"),
                        }
                    )
            continue
        blocks = _input_blocks(content)
        if not blocks:
            blocks = [{"type": "input_text", "text": ""}]
        items.append({"role": "user", "content": blocks})
    return items


def convert_tools(tools: list[dict] | None) -> list[dict[str, Any]] | None:
    """OpenAI 风格工具 → Responses 的**扁平** function 定义；没有有效工具时返回 None。"""
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
                "type": "function",
                "name": name,
                "description": str(function.get("description") or ""),
                "parameters": function.get("parameters") or {"type": "object", "properties": {}},
            }
        )
    return converted or None


__all__ = ["convert_messages", "convert_tools"]
