"""OpenAI 兼容协议的流式事件与思考参数测试。

拆分自 test_openai_compat.py——stream_chat_events 的事件装配（分片工具调用、并行
调用、reasoning 字段、tools 降级重试）与思考参数的请求体注入 / 被拒降级都收在这里。
复用主文件的 helper（_provider / _collect_events / _sse / _stream_response / TOOLS /
_thinking_config）。
"""
import json

import httpx
from app.services.llm.openai_compat import OpenAICompatProvider
from test_openai_compat import (
    TOOLS,
    _collect_events,
    _provider,
    _sse,
    _stream_response,
    _thinking_config,
)


async def test_stream_events_assembles_fragmented_tool_calls():
    """工具参数是一个字符一个字符到达的，必须拼成完整 JSON 再交给调用方。"""
    fragment = '{"title": "后端开发实习生", "company": "字节跳动"}'
    frames = [{"delta": {"tool_calls": [
        {"index": 0, "id": "call_1", "type": "function", "function": {"name": "create_job", "arguments": ""}}
    ]}}]
    frames += [
        {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": character}}]}}
        for character in fragment
    ]
    frames.append({"delta": {}, "finish_reason": "tool_calls"})
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider, TOOLS)

    calls = [call for delta in deltas for call in delta.tool_calls]
    assert len(calls) == 1
    assert calls[0]["id"] == "call_1"
    assert calls[0]["function"]["name"] == "create_job"
    assert json.loads(calls[0]["function"]["arguments"]) == {
        "title": "后端开发实习生",
        "company": "字节跳动",
    }
    assert deltas[-1].finish_reason == "tool_calls"


async def test_stream_events_keeps_parallel_tool_calls_apart():
    """同一次响应里的多个调用靠 index 区分，不能拼接串台。"""
    frames = [
        {"delta": {"tool_calls": [{"index": 0, "id": "a", "function": {"name": "get_job", "arguments": '{"id"'}}]}},
        {"delta": {"tool_calls": [{"index": 1, "id": "b", "function": {"name": "list_jobs", "arguments": ""}}]}},
        {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": ": 1}"}}]}},
        {"delta": {"tool_calls": [{"index": 1, "function": {"arguments": "{}"}}]}},
        {"delta": {}, "finish_reason": "tool_calls"},
    ]
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider, TOOLS)

    calls = [call for delta in deltas for call in delta.tool_calls]
    assert [call["function"]["name"] for call in calls] == ["get_job", "list_jobs"]
    assert calls[0]["function"]["arguments"] == '{"id": 1}'


async def test_stream_events_yields_text_alongside_tool_calls():
    frames = [
        {"delta": {"content": "我来查一下。"}},
        {"delta": {"tool_calls": [{"index": 0, "id": "a", "function": {"name": "list_jobs", "arguments": "{}"}}]}},
        {"delta": {}, "finish_reason": "tool_calls"},
    ]
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider, TOOLS)

    assert "".join(delta.text for delta in deltas) == "我来查一下。"
    assert len([call for delta in deltas for call in delta.tool_calls]) == 1


async def test_stream_events_finalizes_tool_calls_without_a_finish_reason():
    """有的端点不发 finish_reason 就结束，工具调用同样要产出。"""
    frames = [
        {"delta": {"tool_calls": [{"index": 0, "id": "a", "function": {"name": "list_jobs", "arguments": "{}"}}]}},
    ]
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider, TOOLS)

    assert len([call for delta in deltas for call in delta.tool_calls]) == 1


async def test_stream_events_emits_deepseek_reasoning_content():
    """DeepSeek 系把思考内容放在 ``reasoning_content``，要单独产成 reasoning 帧。"""
    frames = [
        {"delta": {"reasoning_content": "先想"}},
        {"delta": {"reasoning_content": "一下"}},
        {"delta": {"content": "答案"}},
    ]
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider)

    assert "".join(delta.reasoning for delta in deltas) == "先想一下"
    # 思考内容与正文分属不同字段，不能互相污染。
    assert "".join(delta.text for delta in deltas) == "答案"


async def test_stream_events_tolerates_the_reasoning_field_name():
    """字段名不统一是常态：有的网关用 ``reasoning``，同样要认。"""
    frames = [{"delta": {"reasoning": "思考片段"}}, {"delta": {"content": "好"}}]
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider)

    assert "".join(delta.reasoning for delta in deltas) == "思考片段"


async def test_stream_events_without_reasoning_produces_nothing():
    """两个字段都缺失是常态（普通模型、未开思考）——什么都不产出，绝不臆造。"""
    frames = [{"delta": {"content": "没有思考内容"}}]
    provider = _provider(lambda _request: _stream_response(_sse(frames) + "data: [DONE]\n\n"))

    deltas = await _collect_events(provider)

    assert all(delta.reasoning == "" for delta in deltas)
    assert "".join(delta.text for delta in deltas) == "没有思考内容"


async def test_stream_events_sends_tools_only_when_asked():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _stream_response(_sse([{"delta": {"content": "ok"}}]) + "data: [DONE]\n\n")

    await _collect_events(_provider(handler), TOOLS)
    await _collect_events(_provider(handler))

    assert bodies[0]["tools"] == TOOLS
    assert bodies[0]["tool_choice"] == "auto"
    assert "tools" not in bodies[1]


async def test_stream_events_falls_back_when_the_provider_rejects_tools():
    """不支持 tools 的端点会直接 400；此时去掉工具重试一次，而不是整体失败。"""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "tools" in body:
            return httpx.Response(400, json={"error": {"message": "tools is not supported"}})
        return _stream_response(_sse([{"delta": {"content": "降级后的回答"}}]) + "data: [DONE]\n\n")

    deltas = await _collect_events(_provider(handler), TOOLS)

    assert len(bodies) == 2
    assert "tools" in bodies[0] and "tools" not in bodies[1]
    assert "".join(delta.text for delta in deltas) == "降级后的回答"
def test_thinking_off_keeps_the_request_body_unchanged():
    """**兼容红线**：默认（关）时请求体与加这个功能之前逐字节一致。

    升级不能替用户打开一个他没用过的参数——不支持它的服务商会直接 400，
    表现成"升级完所有 AI 功能都坏了"。
    """
    payload = OpenAICompatProvider(_thinking_config())._build_payload(
        [{"role": "user", "content": "hi"}], stream=False
    )

    assert "reasoning_effort" not in payload
    assert "thinking" not in payload


def test_thinking_on_sends_the_effort():
    payload = OpenAICompatProvider(
        _thinking_config(thinking_enabled=True, thinking_effort="low")
    )._build_payload([{"role": "user", "content": "hi"}], stream=False)

    assert payload["reasoning_effort"] == "low"


def test_the_explicit_budget_field_still_beats_the_new_switch():
    """老字段优先：显式填过「思考预算」的，不能被新开关改写（既有行为不变）。"""
    payload = OpenAICompatProvider(
        _thinking_config(thinking_budget=4096, thinking_enabled=True, thinking_effort="low")
    )._build_payload([{"role": "user", "content": "hi"}], stream=False)

    assert payload["thinking"] == {"type": "enabled", "budget_tokens": 4096}
    assert "reasoning_effort" not in payload


def test_the_request_level_effort_works_while_the_settings_switch_is_off():
    """助手页的「思考强度」与设置页的「思考模式」是**两条独立的路**。

    设置页默认关着，助手选的低/中/高照样要发出去——否则"设置页没开"会把助手的选择
    一起吃掉，而两者本来就不该互相影响。
    """
    payload = OpenAICompatProvider(
        _thinking_config(), request_overrides={"reasoning_effort": "low"}
    )._build_payload([{"role": "user", "content": "hi"}], stream=False)

    assert payload["reasoning_effort"] == "low"


def test_a_stripped_config_keeps_the_settings_switch_out_of_the_assistant():
    """助手那条路拿到的是 ``without_thinking()`` 剥过的配置：设置页开着也不发。

    这条钉住"两者分开"的**另一半**——设置页开一次开关，不该把助手的每一轮对话也改掉；
    助手在页面上选「默认」时，请求体里就该什么都没有。
    """
    config = _thinking_config(thinking_enabled=True, thinking_effort="high")

    payload = OpenAICompatProvider(
        config.without_thinking(), request_overrides={"reasoning_effort": ""}
    )._build_payload([{"role": "user", "content": "hi"}], stream=False)

    assert "reasoning_effort" not in payload
    assert "thinking" not in payload


async def test_stream_events_drops_the_thinking_parameters_when_rejected():
    """有的服务商不认思考参数并直接 400：去掉它重试一次，而不是让整个功能不可用。"""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "reasoning_effort" in body:
            return httpx.Response(400, json={"error": {"message": "unsupported parameter"}})
        return _stream_response(_sse([{"delta": {"content": "降级后的回答"}}]) + "data: [DONE]\n\n")

    provider = OpenAICompatProvider(
        _thinking_config(thinking_enabled=True, thinking_effort="low"),
        transport=httpx.MockTransport(handler),
    )
    deltas = await _collect_events(provider)

    assert len(bodies) == 2
    assert bodies[0]["reasoning_effort"] == "low"
    assert "reasoning_effort" not in bodies[1]
    assert "".join(delta.text for delta in deltas) == "降级后的回答"


async def test_stream_events_drops_a_rejected_request_level_effort():
    """助手页选的强度被上游拒绝时，同样降级重试一次。

    只看配置里的开关会漏掉这一条：助手的配置是被 ``without_thinking()`` 剥过的，它的思考
    强度走**请求级**参数。漏掉的话，助手选了一个上游不认的档位就只能报错。
    """
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "reasoning_effort" in body:
            return httpx.Response(400, json={"error": {"message": "unsupported parameter"}})
        return _stream_response(_sse([{"delta": {"content": "降级后的回答"}}]) + "data: [DONE]\n\n")

    provider = OpenAICompatProvider(
        _thinking_config().without_thinking(),  # 助手那条路拿到的配置
        transport=httpx.MockTransport(handler),
        request_overrides={"reasoning_effort": "none"},
    )
    deltas = await _collect_events(provider)

    assert len(bodies) == 2
    assert bodies[0]["reasoning_effort"] == "none"
    assert "reasoning_effort" not in bodies[1]
    assert "".join(delta.text for delta in deltas) == "降级后的回答"


async def test_stream_events_can_downgrade_tools_and_thinking_in_turn():
    """两个参数都被拒时，两次降级都要发生（各一次），最终还是拿到回答。"""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "tools" in body or "reasoning_effort" in body:
            return httpx.Response(400, json={"error": {"message": "unsupported parameter"}})
        return _stream_response(_sse([{"delta": {"content": "干净的请求"}}]) + "data: [DONE]\n\n")

    provider = OpenAICompatProvider(
        _thinking_config(thinking_enabled=True, thinking_effort="high"),
        transport=httpx.MockTransport(handler),
    )
    deltas = await _collect_events(provider, TOOLS)

    assert len(bodies) == 3
    assert "tools" in bodies[0] and "reasoning_effort" in bodies[0]
    assert "tools" not in bodies[1] and "reasoning_effort" in bodies[1]
    assert "tools" not in bodies[2] and "reasoning_effort" not in bodies[2]
    assert "".join(delta.text for delta in deltas) == "干净的请求"
