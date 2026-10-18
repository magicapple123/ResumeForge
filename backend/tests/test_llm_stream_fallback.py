"""非流式传输断连 → SSE 流式降级（2026-10-18 网关实测问题的回归测试）。

钉住的不变式：
- 非流式 chat() 遇到传输层断连（httpx.RequestError 家族）时，以同参数走一次
  SSE 流并聚合全文返回——对用户透明，只多一条 warning 日志；
- 降级也失败时错误文案与既有语义一致（「无法连接模型服务…」），last_usage 有记录；
- 超时（httpx.TimeoutException）与硬 deadline **不**触发降级——结果未知时重放
  违反安全点规则（§2.4），维持既有「不自动重放」约定；
- 正常成功路径不多发请求（降级只在断连后发生）；
- 4xx/5xx 状态码错误不落入降级（它们走各自既有路径，由 gate 决定重试/报错）。
"""
import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.base import LLMError
from app.services.llm.openai_compat import OpenAICompatProvider


def _config(**overrides) -> LLMConfig:
    values = {
        "base_url": "https://api.example.com/v1",
        "api_key": "k",
        "model": "m1",
        "timeout_seconds": 10,
    }
    values.update(overrides)
    return LLMConfig(**values)


def _sse(*texts: str) -> bytes:
    frames = []
    for text in texts:
        frames.append(
            "data: " + json.dumps({"choices": [{"delta": {"content": text}, "finish_reason": None}]})
        )
    frames.append(
        "data: "
        + json.dumps(
            {
                "choices": [{"delta": {}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12},
            }
        )
    )
    frames.append("data: [DONE]")
    return ("\n\n".join(frames) + "\n\n").encode()


def _ok_body(text: str = "好") -> bytes:
    return json.dumps({"choices": [{"message": {"content": text}, "finish_reason": "stop"}]}).encode()


def _is_stream_request(request: httpx.Request) -> bool:
    return bool(json.loads(request.content).get("stream"))


def _disconnect_then_stream(nonstream_exc: Exception):
    """非流式请求抛传输错误；流式请求回 SSE 正文。按请求顺序计数。"""
    state = {"nonstream": 0, "stream": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if _is_stream_request(request):
            state["stream"] += 1
            return httpx.Response(200, content=_sse("好的", "，收到"))
        state["nonstream"] += 1
        raise nonstream_exc

    return httpx.MockTransport(handler), state


async def test_disconnect_falls_back_to_stream_and_returns_text():
    transport, state = _disconnect_then_stream(httpx.ReadError("connection closed"))
    provider = OpenAICompatProvider(_config(), transport=transport)

    result = await provider.chat([{"role": "user", "content": "hi"}])

    assert result == "好的，收到"
    assert state == {"nonstream": 1, "stream": 1}
    usage = provider.last_usage
    assert usage is not None
    assert usage.finish_reason == "stop"
    assert usage.prompt_tokens == 5 and usage.completion_tokens == 7


async def test_connect_error_also_falls_back():
    """ConnectError 与 ReadError 同属 httpx.RequestError 家族，降级同样生效。"""
    transport, state = _disconnect_then_stream(httpx.ConnectError("connection refused"))
    provider = OpenAICompatProvider(_config(), transport=transport)

    assert await provider.chat([{"role": "user", "content": "hi"}]) == "好的，收到"
    assert state == {"nonstream": 1, "stream": 1}


async def test_stream_fallback_failure_keeps_original_error_message():
    """降级路径同样断连时：错误文案维持既有语义，用量记为 error。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadError("connection closed")

    provider = OpenAICompatProvider(_config(), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError) as exc_info:
        await provider.chat([{"role": "user", "content": "hi"}])

    assert "无法连接模型服务" in str(exc_info.value)
    usage = provider.last_usage
    assert usage is not None and usage.finish_reason == "error"


async def test_timeout_does_not_trigger_stream_fallback():
    """超时不降级：结果未知时重放违反安全点规则，维持既有「不自动重放」。"""
    state = {"nonstream": 0, "stream": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if _is_stream_request(request):
            state["stream"] += 1
            return httpx.Response(200, content=_sse("不该发生"))
        state["nonstream"] += 1
        raise httpx.ReadTimeout("read timed out")

    provider = OpenAICompatProvider(_config(), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError) as exc_info:
        await provider.chat([{"role": "user", "content": "hi"}])

    assert "响应超时" in str(exc_info.value)
    assert state == {"nonstream": 1, "stream": 0}


async def test_http_status_error_does_not_trigger_stream_fallback():
    """401 等状态码错误走既有路径报错，不进入流式降级。"""
    state = {"nonstream": 0, "stream": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if _is_stream_request(request):
            state["stream"] += 1
            return httpx.Response(200, content=_sse("不该发生"))
        state["nonstream"] += 1
        return httpx.Response(401, content=b"unauthorized")

    provider = OpenAICompatProvider(_config(), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError):
        await provider.chat([{"role": "user", "content": "hi"}])

    assert state == {"nonstream": 1, "stream": 0}


async def test_normal_success_sends_exactly_one_request():
    """未断连时行为与降级引入前完全一致：一次非流式请求，不多发。"""
    state = {"nonstream": 0, "stream": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if _is_stream_request(request):
            state["stream"] += 1
        else:
            state["nonstream"] += 1
        return httpx.Response(200, content=_ok_body())

    provider = OpenAICompatProvider(_config(), transport=httpx.MockTransport(handler))
    assert await provider.chat([{"role": "user", "content": "hi"}]) == "好"
    assert state == {"nonstream": 1, "stream": 0}


async def test_stream_fallback_midstream_error_propagates():
    """降级流建立后返回非 200：状态码按既有文案表转 LLMError，不二次排队。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if _is_stream_request(request):
            return httpx.Response(500, content=b"boom")
        raise httpx.ReadError("connection closed")

    provider = OpenAICompatProvider(_config(), transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError):
        await provider.chat([{"role": "user", "content": "hi"}])
    usage = provider.last_usage
    assert usage is not None and usage.finish_reason == "error"
