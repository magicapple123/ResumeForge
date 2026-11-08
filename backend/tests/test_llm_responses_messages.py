# SPDX-License-Identifier: Apache-2.0
"""T09：Responses 的纯结构转换守卫（responses_messages，无网络）。

重点钉住三条协议硬约束：工具结果与 function_call 的 call_id 配对且顺序在后、
工具定义扁平化、图片只允许出现在 user 消息里（其余位置会被服务端 400）。
"""

from app.services.llm.responses_messages import convert_messages, convert_tools


def test_tool_result_round_trip_keeps_call_id_pairing_and_order():
    converted = convert_messages(
        [
            {"role": "user", "content": "有哪些岗位？"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "list_jobs", "arguments": '{"limit": 5}'},
                    },
                    {
                        "id": "call_2",
                        "type": "function",
                        "function": {"name": "read_resume", "arguments": "{}"},
                    },
                ],
            },
            {"role": "tool", "tool_call_id": "call_1", "content": "3 个岗位"},
            {"role": "tool", "tool_call_id": "call_2", "content": "简历内容"},
        ]
    )

    assert [item.get("type") or item.get("role") for item in converted] == [
        "user",
        "function_call",
        "function_call",
        "function_call_output",
        "function_call_output",
    ]
    # function_call 必须全部排在 function_call_output 之前（协议顺序硬约束）。
    assert [item["call_id"] for item in converted[1:3]] == ["call_1", "call_2"]
    assert [item["call_id"] for item in converted[3:5]] == ["call_1", "call_2"]
    assert converted[1]["name"] == "list_jobs"
    assert converted[1]["arguments"] == '{"limit": 5}'
    assert converted[3]["output"] == "3 个岗位"


def test_assistant_text_and_tool_calls_become_sibling_items():
    converted = convert_messages(
        [
            {"role": "system", "content": "你是助手"},
            {"role": "user", "content": "查一下"},
            {
                "role": "assistant",
                "content": "我来查",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"}}
                ],
            },
        ]
    )

    assert converted[0] == {
        "role": "system",
        "content": [{"type": "input_text", "text": "你是助手"}],
    }
    # assistant 正文变成 message item，工具调用与它是同级 item（不是嵌在消息里）。
    assert converted[2] == {
        "role": "assistant",
        "content": [{"type": "output_text", "text": "我来查"}],
    }
    assert converted[3] == {
        "type": "function_call",
        "call_id": "c1",
        "name": "f",
        "arguments": "{}",
    }


def test_image_blocks_only_live_in_user_messages():
    converted = convert_messages(
        [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": "sys"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "看图"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,BB"}},
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,CC"}},
                ],
            },
        ]
    )

    assert converted[0]["role"] == "system"
    assert [block["type"] for block in converted[0]["content"]] == ["input_text"]
    assert converted[1]["content"][1] == {
        "type": "input_image",
        "image_url": "data:image/png;base64,BB",
    }
    # assistant 带图会被服务端 400：转换时直接丢弃（空消息不产出 item）。
    assert all(item.get("role") != "assistant" for item in converted)


def test_convert_tools_flattens_and_skips_nameless_tools():
    assert convert_tools(
        [
            {
                "type": "function",
                "function": {
                    "name": "a",
                    "description": "d",
                    "parameters": {"type": "object"},
                },
            },
            {"type": "function", "function": {"name": "", "description": "x"}},
        ]
    ) == [
        {
            "type": "function",
            "name": "a",
            "description": "d",
            "parameters": {"type": "object"},
        }
    ]
    assert convert_tools([]) is None
    assert convert_tools(None) is None
