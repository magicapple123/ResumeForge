"""Anthropic provider 的思考（thinking）强度映射与 400 诊断测试。

拆分自 test_llm_anthropic.py——reasoning_effort → budget_tokens 的映射表、设置页开关
与助手请求级强度的优先级、思考开启时的 400 诊断文案都收在这里。
"""
import json

import httpx
import pytest

from app.services.llm.anthropic import AnthropicProvider
from app.services.llm.base import LLMError

from test_llm_anthropic import _config, _provider, _sse


@pytest.mark.asyncio
async def test_reasoning_effort_maps_to_thinking_budget():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_sse([{"type": "message_stop"}]))

    provider = AnthropicProvider(
        _config(), transport=httpx.MockTransport(handler), request_overrides={"reasoning_effort": "high"}
    )
    async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
        pass

    body = captured["body"]
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 16_384}
    # 开启思考时协议要求 temperature 为 1，且预算要小于 max_tokens。
    assert body["temperature"] == 1.0
    assert body["max_tokens"] > 16_384


@pytest.mark.asyncio
async def test_the_settings_switch_maps_to_a_budget():
    """设置页的「思考模式」在原生协议下按档位换算预算（与助手的强度共用一张表）。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_sse([{"type": "message_stop"}]))

    provider = AnthropicProvider(
        _config(thinking_enabled=True, thinking_effort="low"), transport=httpx.MockTransport(handler)
    )
    async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
        pass

    body = captured["body"]
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 2_048}
    assert body["temperature"] == 1.0
    assert body["max_tokens"] > 2_048


@pytest.mark.asyncio
async def test_thinking_off_keeps_the_native_body_unchanged():
    """**兼容红线**：默认（关）时原生请求体与加这个功能之前一致（不发 thinking）。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_sse([{"type": "message_stop"}]))

    provider = AnthropicProvider(_config(), transport=httpx.MockTransport(handler))
    async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
        pass

    assert "thinking" not in captured["body"]
    assert captured["body"]["temperature"] == 0.2


@pytest.mark.asyncio
async def test_the_assistant_effort_still_beats_the_settings_switch():
    """优先级：助手页的请求级强度 > 设置页的开关（两者必须互不干扰）。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_sse([{"type": "message_stop"}]))

    provider = AnthropicProvider(
        _config(thinking_enabled=True, thinking_effort="low"),
        transport=httpx.MockTransport(handler),
        request_overrides={"reasoning_effort": "high"},
    )
    async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
        pass

    assert captured["body"]["thinking"] == {"type": "enabled", "budget_tokens": 16_384}


@pytest.mark.asyncio
async def test_the_assistant_without_its_own_effort_does_not_inherit_the_switch():
    """助手侧传进来的配置已经被 ``without_thinking()`` 剥干净——它只认自己的选择。

    这条守的是"两者分开"：设置页开一次开关，不该把助手的对话一起改掉。
    """
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_sse([{"type": "message_stop"}]))

    provider = AnthropicProvider(
        _config(thinking_enabled=True, thinking_effort="high").without_thinking(),
        transport=httpx.MockTransport(handler),
        request_overrides={"reasoning_effort": ""},
    )
    async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
        pass

    assert "thinking" not in captured["body"]
    assert captured["body"]["temperature"] == 0.2


def test_custom_efforts_map_to_a_budget_or_the_default_depth():
    """助手页与设置页都允许**自定义档位**：数字当预算，认不得的词按默认档。

    最坏的结果是静默变成"不思考"（用户要的是思考，只是词不认识），所以这里宁可给一个
    默认深度；OpenAI 兼容侧不受影响——那里是原样透传。
    """
    from app.services.llm.thinking import DEFAULT_EFFORT, EFFORT_BUDGETS

    numeric = AnthropicProvider(_config(), request_overrides={"reasoning_effort": "4096"})
    unknown_word = AnthropicProvider(_config(), request_overrides={"reasoning_effort": "xhigh"})

    assert numeric._thinking_budget() == 4096
    assert unknown_word._thinking_budget() == EFFORT_BUDGETS[DEFAULT_EFFORT]


@pytest.mark.asyncio
async def test_disabled_thinking_is_explicit():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_sse([{"type": "message_stop"}]))

    provider = AnthropicProvider(
        _config(), transport=httpx.MockTransport(handler), request_overrides={"reasoning_effort": "none"}
    )
    async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
        pass

    assert captured["body"]["thinking"] == {"type": "disabled"}
    assert captured["body"]["temperature"] == 0.2


@pytest.mark.asyncio
async def test_stream_error_event_becomes_llm_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse([{"type": "error", "error": {"type": "overloaded_error", "message": "忙"}}]),
        )

    provider = _provider(handler)
    with pytest.raises(LLMError, match="忙"):
        async for _ in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
            pass


@pytest.mark.asyncio
async def test_http_400_gives_actionable_message():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "bad"}})

    provider = _provider(handler)
    with pytest.raises(LLMError, match="HTTP 400"):
        await provider.chat([{"role": "user", "content": "hi"}])


@pytest.mark.asyncio
async def test_thinking_with_tool_history_explains_the_real_cause():
    """开了思考又在多轮工具调用里报 400：要指向真正的原因（thinking 块未回传），
    而不是把用户支去改模型名 / max_tokens / 预算。

    这一组合下的 400 几乎必然是协议层"没回传 thinking 块"；若给通用文案，用户会去改
    一堆无关参数、白忙一场——比不提示更糟。
    """

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "bad"}})

    provider = AnthropicProvider(
        _config(),
        transport=httpx.MockTransport(handler),
        request_overrides={"reasoning_effort": "high"},
    )
    messages = [
        {"role": "user", "content": "查一下岗位"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "t1",
                    "type": "function",
                    "function": {"name": "list_jobs", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "t1", "content": "结果"},
    ]
    with pytest.raises(LLMError, match="思考强度") as excinfo:
        async for _ in provider.stream_chat_events(messages):
            pass

    message = str(excinfo.value)
    assert "回传" in message
    # 不再把用户支去改模型名 / 预算——那才是要修掉的误导。
    assert "检查模型名称" not in message


@pytest.mark.asyncio
async def test_plain_400_keeps_the_generic_message():
    """普通 400 仍是通用提示：改那条文案不能波及其它场景（开思考但没工具、有工具但没开思考）。"""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "bad"}})

    # 开了思考但没有工具历史 → 通用提示
    thinking_only = AnthropicProvider(
        _config(),
        transport=httpx.MockTransport(handler),
        request_overrides={"reasoning_effort": "high"},
    )
    with pytest.raises(LLMError, match="检查模型名称") as first:
        async for _ in thinking_only.stream_chat_events([{"role": "user", "content": "hi"}]):
            pass
    assert "回传" not in str(first.value)

    # 有工具历史但没开思考 → 通用提示
    tools_only = _provider(handler)
    with pytest.raises(LLMError, match="检查模型名称") as second:
        async for _ in tools_only.stream_chat_events(
            [
                {"role": "user", "content": "查一下"},
                {"role": "tool", "tool_call_id": "t1", "content": "结果"},
            ]
        ):
            pass
    assert "回传" not in str(second.value)


@pytest.mark.asyncio
async def test_unlimited_tokens_fall_back_to_a_concrete_limit():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})

    # max_tokens=0 表示「不限制」，但 Messages 协议必须给一个具体值。
    provider = _provider(handler, max_tokens=0)
    await provider.chat([{"role": "user", "content": "hi"}])

    assert captured["body"]["max_tokens"] == 8192


@pytest.mark.asyncio
async def test_image_blocks_are_converted_from_openai_shape():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})

    provider = _provider(handler)
    await provider.chat(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "看看这张图"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64,aGVsbG8="},
                    },
                ],
            }
        ]
    )

    blocks = captured["body"]["messages"][0]["content"]
    assert blocks[1] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "aGVsbG8="},
    }
