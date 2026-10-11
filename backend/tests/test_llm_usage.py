"""用量/遥测兼容层（RF-14 §2.2）：全部走假传输离线，不碰真实网络。

钉住的核心性质：
- 缺 usage 帧 → token 字段是 None（序列化后是 null），**禁止伪造 0**；
- chat() 返回前写入、流式在**所有路径**（含异常/中断）的 finally 写入；
- 只保留最后一次调用；跨轮累计是调用方责任（summarize 的部分和宁缺毋假）；
- 落库走 ChatMessage.context JSON 列（零迁移），回读形状稳定。
"""
import json

import httpx
import pytest
from app.models.assistant import ChatConversation, ChatMessage
from app.schemas.setting import LLMConfig
from app.services.llm.anthropic import AnthropicProvider
from app.services.llm.base import LLMError
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.usage import LLMUsage, summarize_usages


def _config(**overrides) -> LLMConfig:
    values = {
        "base_url": "https://api.example.com/v1",
        "api_key": "k",
        "model": "m1",
        "timeout_seconds": 10,
    }
    values.update(overrides)
    return LLMConfig(**values)


def _transport(responses: list[tuple[int, dict, bytes]]):
    """按顺序回放 (status, headers, body) 的假传输；超出后重复最后一个。"""
    index = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        status, headers, body = responses[min(index["i"], len(responses) - 1)]
        index["i"] += 1
        return httpx.Response(status, headers=headers, content=body)

    return httpx.MockTransport(handler)


def _sse(*frames: str) -> bytes:
    return ("".join(f"data: {frame}\n\n" for frame in frames)).encode("utf-8")


# ===== OpenAI 兼容层 =====


async def test_chat_records_usage():
    body = json.dumps(
        {
            "choices": [{"message": {"content": "你好"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        }
    ).encode()
    provider = OpenAICompatProvider(_config(), transport=_transport([(200, {}, body)]))
    assert await provider.chat([{"role": "user", "content": "hi"}]) == "你好"

    usage = provider.last_usage
    assert usage is not None
    assert usage.model == "m1"
    assert usage.prompt_tokens == 11
    assert usage.completion_tokens == 7
    assert usage.total_tokens == 18
    assert isinstance(usage.elapsed_ms, int) and usage.elapsed_ms >= 0
    assert usage.finish_reason == "stop"
    assert usage.retries == 0


async def test_chat_missing_usage_is_none_not_zero():
    body = json.dumps(
        {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]}
    ).encode()
    provider = OpenAICompatProvider(_config(), transport=_transport([(200, {}, body)]))
    await provider.chat([{"role": "user", "content": "hi"}])

    usage = provider.last_usage
    assert usage is not None
    assert usage.prompt_tokens is None
    assert usage.completion_tokens is None
    assert usage.total_tokens is None
    # 序列化后必须是 null（不是 0）：前端据此展示「未知」。
    assert "null" in json.dumps(usage.to_dict())
    assert usage.to_dict()["prompt_tokens"] is None


async def test_stream_without_usage_frame_yields_none():
    sse = _sse(
        '{"choices": [{"delta": {"content": "你"}}]}',
        '{"choices": [{"delta": {}, "finish_reason": "stop"}]}',
        "[DONE]",
    )
    provider = OpenAICompatProvider(
        _config(),
        transport=_transport([(200, {"content-type": "text/event-stream"}, sse)]),
    )
    deltas = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]
    assert "".join(delta.text for delta in deltas) == "你"

    usage = provider.last_usage
    assert usage is not None
    assert usage.finish_reason == "stop"
    assert usage.prompt_tokens is None
    assert usage.completion_tokens is None
    assert usage.total_tokens is None


async def test_stream_reads_vendor_supplied_usage_frame():
    """服务商自带的 usage 帧（无 choices）也要读；缺失的不臆造。"""
    sse = _sse(
        '{"choices": [{"delta": {"content": "好"}}]}',
        '{"choices": [{"delta": {}, "finish_reason": "length"}]}',
        '{"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 3}}',
        "[DONE]",
    )
    provider = OpenAICompatProvider(
        _config(),
        transport=_transport([(200, {"content-type": "text/event-stream"}, sse)]),
    )
    _ = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]

    usage = provider.last_usage
    assert usage is not None
    assert usage.prompt_tokens == 5
    assert usage.completion_tokens == 3
    assert usage.total_tokens == 8
    assert usage.finish_reason == "length"


async def test_stream_error_still_records_usage():
    provider = OpenAICompatProvider(
        _config(), transport=_transport([(401, {}, b'{"error": "bad key"}')])
    )
    with pytest.raises(LLMError):
        _ = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]

    usage = provider.last_usage
    assert usage is not None
    assert usage.finish_reason == "error"
    assert usage.prompt_tokens is None
    assert usage.elapsed_ms >= 0


async def test_cancelled_stream_records_cancelled():
    sse = _sse(
        '{"choices": [{"delta": {"content": "第一段"}}]}',
        '{"choices": [{"delta": {"content": "第二段"}}]}',
        "[DONE]",
    )
    provider = OpenAICompatProvider(
        _config(),
        transport=_transport([(200, {"content-type": "text/event-stream"}, sse)]),
    )
    stream = provider.stream_chat_events([{"role": "user", "content": "hi"}])
    first = await stream.__anext__()
    assert first.text == "第一段"
    await stream.aclose()  # 模拟浏览器断开：消费方关闭生成器

    usage = provider.last_usage
    assert usage is not None
    assert usage.finish_reason == "cancelled"


async def test_each_call_records_separately_not_cumulated():
    bodies = [
        json.dumps(
            {"choices": [{"message": {"content": "一"}, "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 10, "completion_tokens": 2}}
        ).encode(),
        json.dumps(
            {"choices": [{"message": {"content": "二"}, "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 20, "completion_tokens": 4}}
        ).encode(),
    ]
    provider = OpenAICompatProvider(_config(), transport=_transport([(200, {}, b) for b in bodies]))
    await provider.chat([{"role": "user", "content": "1"}])
    await provider.chat([{"role": "user", "content": "2"}])

    usage = provider.last_usage
    assert usage is not None
    # 只保留最后一次调用：跨轮累计是调用方责任。
    assert usage.prompt_tokens == 20
    assert usage.completion_tokens == 4


# ===== Anthropic 原生层 =====


async def test_anthropic_stream_usage_extraction():
    sse = _sse(
        '{"type": "message_start", "message": {"usage": {"input_tokens": 9}}}',
        '{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "好"}}',
        '{"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 4}}',
    )
    config = _config(base_url="https://api.anthropic.com", model="claude-x", api_style="anthropic")
    provider = AnthropicProvider(
        config, transport=_transport([(200, {"content-type": "text/event-stream"}, sse)])
    )
    deltas = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]
    assert "".join(delta.text for delta in deltas) == "好"

    usage = provider.last_usage
    assert usage is not None
    assert usage.prompt_tokens == 9
    assert usage.completion_tokens == 4
    assert usage.total_tokens == 13
    assert usage.finish_reason == "stop"


async def test_anthropic_tool_use_stop_reason_normalized():
    sse = _sse(
        '{"type": "message_start", "message": {"usage": {"input_tokens": 1}}}',
        '{"type": "content_block_start", "index": 0, "content_block": '
        '{"type": "tool_use", "id": "t1", "name": "list_jobs"}}',
        '{"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": "{}"}}',
        '{"type": "content_block_stop", "index": 0}',
        '{"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 2}}',
    )
    config = _config(base_url="https://api.anthropic.com", model="claude-x", api_style="anthropic")
    provider = AnthropicProvider(
        config, transport=_transport([(200, {"content-type": "text/event-stream"}, sse)])
    )
    deltas = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]
    assert deltas[-1].tool_calls and deltas[-1].tool_calls[0]["function"]["name"] == "list_jobs"

    usage = provider.last_usage
    assert usage is not None
    assert usage.finish_reason == "tool_calls"


async def test_anthropic_missing_usage_is_none_not_zero():
    """两家都没有 usage 时不臆造：字段保持 None。"""
    sse = _sse(
        '{"type": "message_start", "message": {}}',
        '{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "好"}}',
        '{"type": "message_delta", "delta": {"stop_reason": "end_turn"}}',
    )
    config = _config(base_url="https://api.anthropic.com", model="claude-x", api_style="anthropic")
    provider = AnthropicProvider(
        config, transport=_transport([(200, {"content-type": "text/event-stream"}, sse)])
    )
    _ = [delta async for delta in provider.stream_chat_events([{"role": "user", "content": "hi"}])]

    usage = provider.last_usage
    assert usage is not None
    assert usage.prompt_tokens is None
    assert usage.completion_tokens is None


# ===== 跨轮汇总（调用方责任）=====


def test_summarize_aggregates_and_refuses_partial_sums():
    partial = LLMUsage(
        model="m", prompt_tokens=10, completion_tokens=None, total_tokens=None,
        elapsed_ms=100, finish_reason="stop",
    )
    full = LLMUsage(
        model="m", prompt_tokens=5, completion_tokens=3, total_tokens=8,
        elapsed_ms=50, finish_reason="tool_calls", retries=1,
    )
    summary = summarize_usages([partial, full])
    assert summary is not None
    # 只汇总"每一轮都有值"的字段：prompt 两轮都有 → 求和；completion/total 部分
    # 缺失 → 宁给 None（展示「未知」），不给会被误读为完整值的部分和。
    assert summary["prompt_tokens"] == 15
    assert summary["completion_tokens"] is None
    assert summary["total_tokens"] is None
    assert summary["elapsed_ms"] == 150
    assert summary["retries"] == 1
    assert summary["finish_reason"] == "tool_calls"

    complete = summarize_usages(
        [
            LLMUsage(model="m", prompt_tokens=10, completion_tokens=2, total_tokens=12,
                     elapsed_ms=10, finish_reason="stop"),
            LLMUsage(model="m", prompt_tokens=5, completion_tokens=3, total_tokens=8,
                     elapsed_ms=20, finish_reason="stop"),
        ]
    )
    assert complete == {
        "model": "m", "prompt_tokens": 15, "completion_tokens": 5, "total_tokens": 20,
        "elapsed_ms": 30, "finish_reason": "stop", "retries": 0,
    }

    assert summarize_usages([]) is None
    overridden = summarize_usages([full], finish_reason="budget_exhausted")
    assert overridden is not None
    assert overridden["finish_reason"] == "budget_exhausted"


# ===== 落库（ChatMessage.context JSON 列，零迁移）=====


async def test_usage_round_trips_through_chat_message_context(db_session):
    conversation = ChatConversation(title="用量回读")
    db_session.add(conversation)
    db_session.commit()
    message = ChatMessage(conversation_id=conversation.id, role="assistant", content="回复")
    db_session.add(message)
    db_session.commit()
    message_id = message.id

    usage_payload = {
        "model": "m1", "prompt_tokens": 11, "completion_tokens": None, "total_tokens": None,
        "elapsed_ms": 88, "finish_reason": "stop", "retries": 0,
    }
    from app.api.assistant_persistence import finish_assistant_message

    saved = finish_assistant_message(message_id, content="回复", status="complete", usage=usage_payload)
    assert saved is not None

    db_session.expire_all()
    reloaded = db_session.get(ChatMessage, message_id)
    assert reloaded is not None
    # 历史回读形状稳定：缺失 token 是 null 而不是 0，字段齐全。
    stored = reloaded.context["usage"]
    assert stored == usage_payload
    assert json.loads(json.dumps(stored)) == usage_payload


async def test_finish_assistant_message_without_usage_keeps_context_intact(db_session):
    conversation = ChatConversation(title="无用量")
    db_session.add(conversation)
    db_session.commit()
    message = ChatMessage(
        conversation_id=conversation.id, role="assistant", content="", context={"reasoning": "想"}
    )
    db_session.add(message)
    db_session.commit()

    from app.api.assistant_persistence import finish_assistant_message

    finish_assistant_message(message.id, content="回复", status="complete")

    db_session.expire_all()
    reloaded = db_session.get(ChatMessage, message.id)
    assert reloaded is not None
    assert reloaded.context == {"reasoning": "想"}
