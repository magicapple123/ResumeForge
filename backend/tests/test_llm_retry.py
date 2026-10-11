"""重试治理（RF-14 §2.4）：假传输 + 注入时钟，全离线，不真睡。

钉住的硬性不变式：
- 429 最多 2 次重试（退避 1s→2s，Retry-After 尊重且 8s 封顶）；5xx 最多 1 次；
- 401/404 零重试；非法输出传输层不重试；
- 重试只允许发生在首个 delta 产出之前——流中断零重试；
- 重试次数对外可见（LLMUsage.retries），最终失败消息带「（已自动重试 N 次）」；
- 预算剩余不足 1s 不重试（预算耗尽优先于重试）；
- tool_calls delta 产出后断流：handler 只执行一次，传输层不可能重试。
"""
import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm import retry
from app.services.llm.base import LLMError
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.retry import (
    is_retryable_status,
    parse_retry_after,
    retry_backoff_seconds,
)


def _config(**overrides) -> LLMConfig:
    values = {
        "base_url": "https://api.example.com/v1",
        "api_key": "k",
        "model": "m1",
        "timeout_seconds": 10,
    }
    values.update(overrides)
    return LLMConfig(**values)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _counting_transport(responses: list[tuple[int, dict, bytes]]):
    """按顺序回放 (status, headers, body) 并记录请求次数。"""
    state = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        index = min(state["count"], len(responses) - 1)
        status, headers, body = responses[index]
        state["count"] += 1
        return httpx.Response(status, headers=headers, content=body)

    return _transport(handler), state


@pytest.fixture
def fake_sleep(monkeypatch):
    """注入时钟：记录退避秒数，不真睡（测试毫秒级完成）。"""
    delays: list[float] = []

    async def _sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr(retry, "retry_sleep", _sleep)
    return delays


# ===== 纯函数 =====


def test_retry_backoff_ladder_and_caps():
    assert retry_backoff_seconds(429, 0) == 1.0
    assert retry_backoff_seconds(429, 1) == 2.0
    assert retry_backoff_seconds(429, 2) is None  # 最多 2 次重试
    assert retry_backoff_seconds(500, 0) == 1.0
    assert retry_backoff_seconds(500, 1) is None  # 最多 1 次重试
    assert retry_backoff_seconds(401, 0) is None
    assert retry_backoff_seconds(404, 0) is None
    assert retry_backoff_seconds(400, 0) is None  # 400 走既有降级，不并入本机制
    # Retry-After：尊重且 8s 封顶。
    assert retry_backoff_seconds(429, 0, "3") == 3.0
    assert retry_backoff_seconds(429, 0, "100") == 8.0
    assert retry_backoff_seconds(429, 0, "垃圾") == 1.0
    # 预算剩余不足 1s 不重试。
    assert retry_backoff_seconds(429, 0, deadline_remaining=0.5) is None
    assert retry_backoff_seconds(429, 0, deadline_remaining=5.0) == 1.0
    assert is_retryable_status(503) and not is_retryable_status(403)


def test_parse_retry_after():
    assert parse_retry_after("2") == 2.0
    assert parse_retry_after(" 1.5 ") == 1.5
    assert parse_retry_after("-3") is None
    assert parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT") is None
    assert parse_retry_after(None) is None


# ===== OpenAI 兼容层：非流式 =====


async def test_429_twice_then_success(fake_sleep):
    ok = json.dumps(
        {"choices": [{"message": {"content": "好"}, "finish_reason": "stop"}]}
    ).encode()
    transport, state = _counting_transport(
        [(429, {}, b"rate limited"), (429, {}, b"rate limited"), (200, {}, ok)]
    )
    provider = OpenAICompatProvider(_config(), transport=transport)
    assert await provider.chat([{"role": "user", "content": "hi"}]) == "好"

    assert state["count"] == 3
    assert fake_sleep == [1.0, 2.0]
    usage = provider.last_usage
    assert usage is not None
    assert usage.retries == 2
    assert usage.finish_reason == "stop"


async def test_429_exhausted_error_carries_retry_count(fake_sleep):
    transport, state = _counting_transport([(429, {}, b"rate limited")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    with pytest.raises(LLMError) as exc_info:
        await provider.chat([{"role": "user", "content": "hi"}])

    assert "（已自动重试 2 次）" in str(exc_info.value)
    assert state["count"] == 3
    assert fake_sleep == [1.0, 2.0]
    usage = provider.last_usage
    assert usage is not None
    assert usage.retries == 2
    assert usage.finish_reason == "error"


async def test_retry_after_header_respected_and_capped(fake_sleep):
    capped = json.dumps(
        {"choices": [{"message": {"content": "好"}, "finish_reason": "stop"}]}
    ).encode()
    transport, _ = _counting_transport(
        [(429, {"Retry-After": "100"}, b"x"), (200, {}, capped)]
    )
    provider = OpenAICompatProvider(_config(), transport=transport)
    await provider.chat([{"role": "user", "content": "hi"}])
    assert fake_sleep == [8.0]  # min(100, 8)


async def test_5xx_retries_once(fake_sleep):
    ok = json.dumps(
        {"choices": [{"message": {"content": "好"}, "finish_reason": "stop"}]}
    ).encode()
    transport, state = _counting_transport([(500, {}, b"boom"), (200, {}, ok)])
    provider = OpenAICompatProvider(_config(), transport=transport)
    await provider.chat([{"role": "user", "content": "hi"}])
    assert state["count"] == 2
    assert fake_sleep == [1.0]
    assert provider.last_usage is not None and provider.last_usage.retries == 1

    transport, state = _counting_transport([(500, {}, b"boom")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    with pytest.raises(LLMError) as exc_info:
        await provider.chat([{"role": "user", "content": "hi"}])
    assert "（已自动重试 1 次）" in str(exc_info.value)
    assert state["count"] == 2


async def test_4xx_never_retried(fake_sleep):
    transport, state = _counting_transport([(401, {}, b"unauthorized")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    with pytest.raises(LLMError) as exc_info:
        await provider.chat([{"role": "user", "content": "hi"}])
    assert "已自动重试" not in str(exc_info.value)
    assert state["count"] == 1
    assert fake_sleep == []


async def test_deadline_under_one_second_blocks_retry(fake_sleep):
    """预算剩余不足 1s 不重试：预算耗尽优先于重试（§2.4-4）。"""
    transport, state = _counting_transport([(429, {}, b"rate limited")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    provider.request_deadline_seconds = 0.5
    with pytest.raises(LLMError):
        await provider.chat([{"role": "user", "content": "hi"}])
    assert state["count"] == 1
    assert fake_sleep == []


# ===== OpenAI 兼容层：流式 =====


def _sse(*frames: str) -> bytes:
    return ("".join(f"data: {frame}\n\n" for frame in frames)).encode("utf-8")


async def test_stream_429_at_status_phase_retries_then_streams(fake_sleep):
    sse = _sse(
        '{"choices": [{"delta": {"content": "好"}}]}',
        '{"choices": [{"delta": {}, "finish_reason": "stop"}]}',
        "[DONE]",
    )
    transport, state = _counting_transport(
        [(429, {}, b"rate limited"), (200, {"content-type": "text/event-stream"}, sse)]
    )
    provider = OpenAICompatProvider(_config(), transport=transport)
    deltas = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]
    assert "".join(delta.text for delta in deltas) == "好"
    assert state["count"] == 2
    assert fake_sleep == [1.0]
    usage = provider.last_usage
    assert usage is not None and usage.retries == 1


async def test_stream_mid_body_break_is_never_retried(fake_sleep):
    """流中断零重试：首个 delta 已可能发给调用方，重试会造成文本重复（安全点规则）。"""
    broken = _sse(
        '{"choices": [{"delta": {"content": "第一段"}}]}',
        "不是合法 JSON",
        "[DONE]",
    )
    transport, state = _counting_transport(
        [(200, {"content-type": "text/event-stream"}, broken)]
    )
    provider = OpenAICompatProvider(_config(), transport=transport)
    with pytest.raises(LLMError):
        _ = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]
    assert state["count"] == 1
    assert fake_sleep == []


async def test_tool_calls_delta_then_break_executes_handler_once(client, monkeypatch):
    """§2.4-5 衔接点：含 tool_calls 的调用之后断流——handler 只执行一次。

    传输层重试只发生在状态码阶段（模型根本没机会返回 tool_calls，见
    ``test_stream_mid_body_break_is_never_retried``），工具执行在 ``_run_tool_call``，
    provider 重试不触及该层；写工具的一次性核销由 RF-01 的 authorization 保证
    （即使模型对同一意图提出两次提案，也是两个独立 proposal_id，不存在双写）。
    这里钉住编排层行为：工具执行一次后模型调用断流，工具不重跑、没有第二次执行。
    """
    from app.services.llm.base import LLMError
    from tests.test_assistant import (
        _configure_llm,
        _create_conversation,
        _events,
        _FakeProvider,
        _tool_call,
    )

    class _BreakAfterToolCallsProvider(_FakeProvider):
        """第一轮正常产出 tool_calls；第二轮的模型调用断流。"""

        def __init__(self):
            self.requests = []
            self.calls = 0

        async def stream_chat(self, messages):
            async for delta in self.stream_chat_events(messages):
                if delta.text:
                    yield delta.text

        async def stream_chat_events(self, messages, tools=None):
            self.requests.append({"messages": list(messages), "tools": tools})
            self.calls += 1
            if self.calls == 1:
                yield _tool_call("get_overview", {})
                return
            raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态")

    _configure_llm(client)
    provider = _BreakAfterToolCallsProvider()
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "看看总览"},
    )
    events = _events(response)

    # handler 恰好执行一次（一条 tool 事件），随后按 error 收尾，没有第二次执行。
    tool_events = [event for event in events if event["type"] == "tool"]
    assert len(tool_events) == 1
    assert tool_events[0]["ok"] is True
    assert any(event["type"] == "error" for event in events)
    assert len(provider.requests) == 2
