# SPDX-License-Identifier: Apache-2.0
"""400 响应体的"超长"判定：只读有限字节、只带出一个 bool，且不重试大输入。

守隐私与成本两条线：错误体可能带 prompt 片段，不能进日志或异常 message；
判定为"上下文超长"后不能再走通用重试——同一个请求重发一次必然再失败，还多烧一次钱。
"""

import logging

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.base import LLMError
from app.services.llm.context_length_error import MAX_ERROR_BODY_BYTES, with_context_length_flag
from app.services.llm.responses import ResponsesProvider
from test_openai_compat import TOOLS, _collect_events, _provider


@pytest.mark.parametrize(
    "body", ["context length exceeded", "CONTEXT_LENGTH_EXCEEDED", "maximum context is 128K"]
)
@pytest.mark.parametrize("streaming", [True, False])
async def test_context_400_is_typed_sanitized_and_never_parameter_retried(body, streaming, caplog):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(400, text=body + " PRIVATE_PROVIDER_BODY")

    provider = _provider(handler)
    with caplog.at_level(logging.WARNING), pytest.raises(LLMError) as raised:
        if streaming:
            await _collect_events(provider, TOOLS)
        else:
            await provider.chat([{"role": "user", "content": "hello"}])
    assert len(requests) == 1
    assert getattr(raised.value, "context_length_error", False) is True
    assert "PRIVATE_PROVIDER_BODY" not in str(raised.value) + caplog.text
    assert body not in str(raised.value) + caplog.text
    assert provider.last_usage.finish_reason == "error"


async def test_unrelated_400_keeps_existing_optional_parameter_degradation():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(400, text="unsupported tools parameter PRIVATE_PROVIDER_BODY")

    with pytest.raises(LLMError) as raised:
        await _collect_events(_provider(handler), TOOLS)
    assert len(requests) == 2
    assert getattr(raised.value, "context_length_error", False) is False
    assert "PRIVATE_PROVIDER_BODY" not in str(raised.value)


@pytest.mark.parametrize("streaming", [True, False])
async def test_responses_context_400_uses_same_private_classification(streaming):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(400, text="maximum context length PRIVATE_PROVIDER_BODY")

    provider = ResponsesProvider(
        LLMConfig(base_url="https://api.example.com/v1", model="test", api_style="responses"),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(LLMError) as raised:
        if streaming:
            await _collect_events(provider, TOOLS)
        else:
            await provider.chat([{"role": "user", "content": "hello"}])
    assert len(requests) == 1
    assert getattr(raised.value, "context_length_error", False) is True
    assert "PRIVATE_PROVIDER_BODY" not in str(raised.value)


class CountedStream(httpx.AsyncByteStream):
    def __init__(self, *, fail=False):
        self.reads = 0
        self.closed = False
        self.fail = fail

    async def __aiter__(self):
        self.reads += 1
        if self.fail:
            raise httpx.ReadError("PRIVATE_TRANSPORT_DETAIL")
        yield b"x" * MAX_ERROR_BODY_BYTES
        self.reads += 1
        yield b"context length exceeded PRIVATE_PROVIDER_BODY"

    async def aclose(self):
        self.closed = True


async def test_body_inspection_stops_at_4096_and_does_not_read_later_marker():
    body = CountedStream()
    provider = _provider(lambda _request: httpx.Response(400, stream=body))
    with pytest.raises(LLMError) as raised:
        await _collect_events(provider)
    assert body.reads == 1
    assert body.closed is True
    assert getattr(raised.value, "context_length_error", False) is False


async def test_non_400_does_not_read_error_body():
    body = CountedStream()
    response = httpx.Response(401, stream=body)
    error = LLMError("authorization failed")
    assert await with_context_length_flag(response, error) is error
    assert body.reads == 0
    await response.aclose()


async def test_error_body_transport_failure_closes_and_remains_sanitized(caplog):
    body = CountedStream(fail=True)
    provider = _provider(lambda _request: httpx.Response(400, stream=body))
    with caplog.at_level(logging.WARNING), pytest.raises(LLMError) as raised:
        await _collect_events(provider, TOOLS)
    assert body.reads == 1 and body.closed is True
    assert getattr(raised.value, "context_length_error", False) is False
    assert "PRIVATE_TRANSPORT_DETAIL" not in str(raised.value) + caplog.text
