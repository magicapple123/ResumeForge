# SPDX-License-Identifier: Apache-2.0
"""T09：OpenAI Responses 协议（第三个 api_style）的 provider / 流式 / 连接测试守卫。

覆盖任务书 §4 T09 要求的形态：文本流 / 思考 / 单个与并行工具调用 / 用量 /
response.failed / response.incomplete、请求体形态（含**禁止发送**的字段）、
以及「测试连接」的协议分支与已知不支持服务商提示。全部走 httpx.MockTransport 的
假 SSE 服务器；纯转换函数的用例在 test_llm_responses_messages.py。

真实链路说明：本环境只有 DeepSeek 的 Key，DeepSeek 是否提供 /responses 以实测为准
（见证据目录 T09）。本文件只证明**协议实现正确**，不代表任何厂商已支持。
"""

import json

import httpx
import pytest
from app.schemas.setting import API_STYLES, LLMConfig
from app.services.llm import create_provider
from app.services.llm.base import LLMError
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.responses import ResponsesProvider

_MESSAGES = [{"role": "user", "content": "hi"}]
_TOOL = {
    "type": "function",
    "function": {
        "name": "list_jobs",
        "description": "列出岗位",
        "parameters": {"type": "object", "properties": {"limit": {"type": "integer"}}},
    },
}


def _config(**overrides) -> LLMConfig:
    base = dict(
        api_style="responses",
        base_url="https://api.example.com/v1",
        api_key="k",
        model="m1",
        temperature=0.2,
        max_tokens=2048,
    )
    base.update(overrides)
    return LLMConfig(**base)


def _sse(events: list[dict]) -> bytes:
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode("utf-8")


def _provider(handler, **overrides) -> ResponsesProvider:
    return ResponsesProvider(_config(**overrides), transport=httpx.MockTransport(handler))


async def _collect(provider: ResponsesProvider, *, tools=None) -> list:
    return [delta async for delta in provider.stream_chat_events(_MESSAGES, tools=tools)]


def _capture_stream(events: list[dict], **overrides):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.read())
        return httpx.Response(
            200, content=_sse(events), headers={"content-type": "text/event-stream"}
        )

    return _provider(handler, **overrides), captured


# ===== 默认值与工厂分支 =====


def test_defaults_are_untouched_and_responses_is_only_opt_in():
    """D13 硬约束：默认仍是 Chat Completions，已保存配置一行不改。"""
    assert API_STYLES == ("openai", "anthropic", "responses")
    assert LLMConfig().api_style == "openai"
    # 数据库列是 String(16)，"responses" 9 个字符，不需要迁移。
    assert len("responses") <= 16


def test_create_provider_dispatches_on_api_style():
    assert isinstance(create_provider(_config()), ResponsesProvider)
    assert isinstance(create_provider(_config(api_style="openai")), OpenAICompatProvider)
    assert not isinstance(create_provider(_config(api_style="openai")), ResponsesProvider)


# ===== 请求体形态 =====


@pytest.mark.asyncio
async def test_request_payload_shape_and_forbidden_fields():
    events = [{"type": "response.completed", "response": {"status": "completed", "output": []}}]
    provider, captured = _capture_stream(events)

    await _collect(provider, tools=[_TOOL])

    body = captured["body"]
    assert captured["url"] == "https://api.example.com/v1/responses"
    assert captured["headers"]["authorization"] == "Bearer k"
    # 工具定义必须是扁平的（不是 Chat Completions 的 function 嵌套）。
    assert body["tools"] == [
        {
            "type": "function",
            "name": "list_jobs",
            "description": "列出岗位",
            "parameters": {"type": "object", "properties": {"limit": {"type": "integer"}}},
        }
    ]
    assert body["tool_choice"] == "auto"
    assert body["input"] == [{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}]
    assert body["max_output_tokens"] == 2048
    assert body["temperature"] == 0.2
    # 思考没开就不发 reasoning；这些字段一律不许出现（多数厂商无状态能力，
    # 发了会被 400 或静默忽略——任务书 §4 T09 的硬规则）。
    for forbidden in (
        "reasoning",
        "store",
        "previous_response_id",
        "background",
        "parallel_tool_calls",
        "messages",
    ):
        assert forbidden not in body, forbidden


def test_endpoint_accepts_full_responses_url():
    provider = _provider(
        lambda _r: httpx.Response(200, json={}), base_url="https://x.example/v1/responses"
    )
    assert provider._endpoint() == "https://x.example/v1/responses"


# ===== 流式：文本 / 思考 / 结束事件 =====


@pytest.mark.asyncio
async def test_text_stream_ends_on_completed_without_done_marker():
    events = [
        {"type": "response.created", "response": {"id": "r1"}},
        {"type": "response.output_text.delta", "delta": "你好", "output_index": 0},
        {"type": "response.output_text.delta", "delta": "，世界", "output_index": 0},
        {
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output": [],
                "usage": {"input_tokens": 11, "output_tokens": 7},
            },
        },
    ]
    provider, _captured = _capture_stream(events)

    deltas = await _collect(provider)

    assert "".join(delta.text for delta in deltas) == "你好，世界"
    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "stop"
    assert provider.last_usage.prompt_tokens == 11
    assert provider.last_usage.completion_tokens == 7


@pytest.mark.asyncio
async def test_reasoning_stream_is_kept_out_of_text():
    events = [
        {"type": "response.reasoning_text.delta", "delta": "先想"},
        {"type": "response.reasoning_text.delta", "delta": "一下"},
        {"type": "response.output_text.delta", "delta": "答案"},
        {"type": "response.completed", "response": {"status": "completed", "output": []}},
    ]
    provider, _captured = _capture_stream(events)

    deltas = await _collect(provider)

    assert "".join(delta.reasoning for delta in deltas) == "先想一下"
    # 思考不混进正文（任务书验收：流式思考进 reasoning 字段）。
    assert "".join(delta.text for delta in deltas) == "答案"


@pytest.mark.asyncio
async def test_legacy_gateways_that_still_send_done_are_tolerated():
    events = [
        {"type": "response.output_text.delta", "delta": "好"},
        {"type": "response.completed", "response": {"status": "completed", "output": []}},
    ]
    raw = _sse(events) + b"data: [DONE]\n\n"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=raw, headers={"content-type": "text/event-stream"})

    deltas = await _collect(_provider(handler))

    assert "".join(delta.text for delta in deltas) == "好"


# ===== 工具调用：单个 / 并行 / 兜底 =====


@pytest.mark.asyncio
async def test_parallel_tool_calls_are_all_captured():
    events = [
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "type": "function_call",
                "id": "fc_1",
                "call_id": "call_1",
                "name": "list_jobs",
                "arguments": "",
            },
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": "fc_1",
            "output_index": 0,
            "delta": '{"lim',
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": "fc_1",
            "output_index": 0,
            "delta": 'it": 5}',
        },
        {
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "type": "function_call",
                "id": "fc_1",
                "call_id": "call_1",
                "name": "list_jobs",
                "arguments": '{"limit": 5}',
            },
        },
        {
            "type": "response.output_item.added",
            "output_index": 1,
            "item": {
                "type": "function_call",
                "id": "fc_2",
                "call_id": "call_2",
                "name": "read_resume",
                "arguments": "",
            },
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": "fc_2",
            "output_index": 1,
            "delta": "{}",
        },
        {
            "type": "response.output_item.done",
            "output_index": 1,
            "item": {
                "type": "function_call",
                "id": "fc_2",
                "call_id": "call_2",
                "name": "read_resume",
                "arguments": "{}",
            },
        },
        {
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output": [],
                "usage": {"input_tokens": 5, "output_tokens": 3},
            },
        },
    ]
    provider, _captured = _capture_stream(events)

    deltas = await _collect(provider)

    calls = [call for delta in deltas for call in delta.tool_calls]
    assert [call["id"] for call in calls] == ["call_1", "call_2"]
    assert [call["function"]["name"] for call in calls] == ["list_jobs", "read_resume"]
    # 参数碎片必须拼成可直接 json 解析的字符串（调用方不再关心协议分片）。
    assert json.loads(calls[0]["function"]["arguments"]) == {"limit": 5}
    assert json.loads(calls[1]["function"]["arguments"]) == {}
    # 与 Chat Completions 同一形状：assistant 的 tool_calls 后续直接回传。
    assert all(call["type"] == "function" for call in calls)
    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "stop"


@pytest.mark.asyncio
async def test_completed_without_item_done_still_finalizes_pending_calls():
    events = [
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "type": "function_call",
                "id": "fc_9",
                "call_id": "call_9",
                "name": "f",
                "arguments": "",
            },
        },
        {"type": "response.function_call_arguments.delta", "item_id": "fc_9", "delta": "{}"},
        {
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output": [
                    {
                        "type": "function_call",
                        "id": "fc_9",
                        "call_id": "call_9",
                        "name": "f",
                        "arguments": "{}",
                    }
                ],
            },
        },
    ]
    provider, _captured = _capture_stream(events)

    deltas = await _collect(provider)

    calls = [call for delta in deltas for call in delta.tool_calls]
    assert calls and calls[0]["id"] == "call_9"
    assert calls[0]["function"]["name"] == "f"


# ===== 失败 / 截断 =====


@pytest.mark.asyncio
async def test_response_failed_becomes_llm_error_with_message():
    events = [
        {
            "type": "response.failed",
            "response": {
                "status": "failed",
                "error": {"code": "server_error", "message": "boom"},
            },
        },
    ]
    provider, _captured = _capture_stream(events)

    with pytest.raises(LLMError, match="boom"):
        await _collect(provider)


@pytest.mark.asyncio
async def test_response_incomplete_maps_to_length():
    events = [
        {"type": "response.output_text.delta", "delta": "半句"},
        {
            "type": "response.incomplete",
            "response": {
                "status": "incomplete",
                "incomplete_details": {"reason": "max_output_tokens"},
                "usage": {"input_tokens": 3, "output_tokens": 4},
            },
        },
    ]
    provider, _captured = _capture_stream(events)

    deltas = await _collect(provider)

    assert "".join(delta.text for delta in deltas) == "半句"
    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "length"
    assert provider.last_usage.completion_tokens == 4


@pytest.mark.asyncio
async def test_stream_error_event_becomes_llm_error():
    events = [{"type": "error", "error": {"message": "额度不足"}}]
    provider, _captured = _capture_stream(events)

    with pytest.raises(LLMError, match="额度不足"):
        await _collect(provider)


# ===== 非流式：正文 / 用量 / 截断 =====


def _chat_response(**response_fields) -> bytes:
    data = {
        "model": "m1",
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": "你好"},
                    {"type": "output_text", "text": "世界"},
                ],
            }
        ],
        "usage": {
            "input_tokens": 11,
            "output_tokens": 7,
            "input_tokens_details": {"cached_tokens": 3},
            "output_tokens_details": {"reasoning_tokens": 2},
        },
    }
    data.update(response_fields)
    return json.dumps(data).encode("utf-8")


@pytest.mark.asyncio
async def test_chat_extracts_text_and_maps_usage():
    provider = _provider(lambda _r: httpx.Response(200, content=_chat_response()))

    reply = await provider.chat(_MESSAGES)

    assert reply == "你好世界"
    usage = provider.last_usage
    assert usage is not None
    assert usage.prompt_tokens == 11
    assert usage.completion_tokens == 7
    assert usage.total_tokens == 18
    # 缓存命中映射到既有记账字段（0067 缓存三档计费）。
    assert usage.cache_hit_tokens == 3
    assert usage.finish_reason == "stop"


@pytest.mark.asyncio
async def test_chat_incomplete_maps_to_length():
    provider = _provider(
        lambda _r: httpx.Response(200, content=_chat_response(status="incomplete"))
    )

    await provider.chat(_MESSAGES)

    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "length"


@pytest.mark.asyncio
async def test_chat_failed_status_raises_and_records_error_usage():
    body = json.dumps(
        {"status": "failed", "error": {"message": "预算用完了"}, "output": []}
    ).encode()
    provider = _provider(lambda _r: httpx.Response(200, content=body))

    with pytest.raises(LLMError, match="预算用完了"):
        await provider.chat(_MESSAGES)

    # 失败调用也要留下用量记录（finish_reason=error），与两家老 provider 同一契约。
    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "error"


@pytest.mark.asyncio
async def test_404_message_explains_responses_may_be_unsupported():
    provider = _provider(lambda _r: httpx.Response(404, json={"error": "not found"}))

    with pytest.raises(LLMError, match="不支持 Responses") as excinfo:
        await provider.chat(_MESSAGES)

    assert "HTTP 404" in str(excinfo.value)
