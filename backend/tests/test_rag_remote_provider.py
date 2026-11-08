# SPDX-License-Identifier: Apache-2.0
"""远程 OpenAI 兼容 provider（RAG v3 §4.1/§4.4）：批切片、重试、错误文案、私网矩阵。

全离线：httpx.MockTransport 回放响应，不联网、不调真实 LLM。钉住任务书 §6 的远程单测：
25 条切片边界（第 26 条必须另起一片）、切片失败只重试该片、429/5xx、401/404 可读文案、
维度/条数/坏 JSON、响应体超限、私网开关矩阵、探测维度不依赖 spec.dim，以及请求体只有
model+input（不含身份字段）。
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from app.services.llm import retry
from app.services.llm.embeddings import EmbeddingError, EmbeddingModelSpec
from app.services.llm.embeddings_http import (
    OpenAIHttpEmbeddingProvider,
    TemplateHttpEmbeddingProvider,
    dimension_error_404,
)
from app.services.net_policy import (
    ADDRESS_INVALID,
    ADDRESS_LOOPBACK,
    ADDRESS_PRIVATE,
    ADDRESS_SHARED,
    endpoint_class,
)

_SECRET = "dummy-secret-value"


def _spec(dim: int = 4) -> EmbeddingModelSpec:
    return EmbeddingModelSpec("openai-http", "remote-model", dim, "server", normalize=False)


def _provider(handler, *, base_url="https://api.example.com/v1", spec=None, **kwargs):
    return OpenAIHttpEmbeddingProvider(
        spec or _spec(),
        base_url=base_url,
        api_key=_SECRET,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        **kwargs,
    )


def _ok(*vectors: tuple[float, ...]) -> httpx.Response:
    return httpx.Response(200, json={"data": [{"embedding": list(v)} for v in vectors]})


def _texts(request: httpx.Request) -> list[str]:
    return json.loads(request.content)["input"]


def _dynamic_ok(captured: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        vectors = tuple((0.1,) * 4 for _ in _texts(request))
        return _ok(*vectors)

    return handler


@pytest.fixture
def fake_sleep(monkeypatch):
    delays: list[float] = []

    async def _sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr(retry, "retry_sleep", _sleep)
    return delays


# ===== 请求 / 解析 / 切片 =====


async def test_request_body_has_only_model_and_input():
    captured: list[httpx.Request] = []
    provider = _provider(_dynamic_ok(captured))
    await provider.embed_documents(["资料文本一", "资料文本二"])
    body = json.loads(captured[0].content)
    assert set(body) == {"model", "input"}
    assert body["input"] == ["资料文本一", "资料文本二"]
    assert captured[0].headers["authorization"] == "Bearer " + _SECRET


@pytest.mark.parametrize(
    ("count", "batch_size", "slices"),
    [(25, 25, [25]), (26, 25, [25, 1]), (50, 25, [25, 25]), (5, 4, [4, 1])],
)
async def test_batch_slicing_boundaries(count, batch_size, slices):
    captured: list[httpx.Request] = []
    provider = _provider(_dynamic_ok(captured), batch_size=batch_size)
    batch = await provider.embed_documents([f"text-{index}" for index in range(count)])
    assert [len(_texts(request)) for request in captured] == slices
    assert len(batch.vectors) == count


async def test_slice_failure_retries_only_that_slice(fake_sleep):
    captured: list[httpx.Request] = []
    attempts: dict[int, int] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        size = len(_texts(request))
        attempts[size] = attempts.get(size, 0) + 1
        captured.append(request)
        if size == 1 and attempts[size] == 1:
            return httpx.Response(500)
        return _ok(*((0.2,) * 4 for _ in range(size)))

    provider = _provider(handler)
    batch = await provider.embed_documents([f"text-{index}" for index in range(26)])
    assert [len(_texts(request)) for request in captured] == [25, 1, 1]
    assert batch.retries == 1
    assert fake_sleep == [1.0]


async def test_429_retries_then_succeeds(fake_sleep):
    responses = [httpx.Response(429, headers={"Retry-After": "1"}), _ok((0.5,) * 4)]
    provider = _provider(lambda _request: responses.pop(0))
    batch = await provider.embed_documents(["查询"])
    assert batch.vectors == ((0.5,) * 4,)
    assert (batch.retries, fake_sleep) == (1, [1.0])


async def test_5xx_exhausts_retries_with_readable_error(fake_sleep):
    provider = _provider(lambda _request: httpx.Response(503))
    with pytest.raises(EmbeddingError, match="已自动重试"):
        await provider.embed_documents(["查询"])


# ===== 错误文案 / 坏响应 =====


async def test_401_and_generic_404_are_readable_and_sanitized():
    with pytest.raises(EmbeddingError) as auth_error:
        await _provider(lambda _request: httpx.Response(401)).embed_documents(["查询"])
    assert "API Key 无效或已过期" in str(auth_error.value)
    assert _SECRET not in str(auth_error.value)
    assert "api.example.com" not in str(auth_error.value)

    with pytest.raises(EmbeddingError) as not_found:
        await _provider(lambda _request: httpx.Response(404)).embed_documents(["查询"])
    assert "response" not in str(not_found.value)
    assert "不提供 embeddings 接口" not in str(not_found.value)


async def test_404_maps_known_non_embedding_vendors_only():
    assert "DeepSeek" in dimension_error_404("api.deepseek.com")
    assert "不提供 embeddings 接口" in dimension_error_404("api.deepseek.com")
    assert "不提供 embeddings 接口" not in dimension_error_404("127.0.0.1")
    assert "不提供 embeddings 接口" not in dimension_error_404("localhost")
    assert "不提供 embeddings 接口" not in dimension_error_404("api.example.com")

    with pytest.raises(EmbeddingError) as excinfo:
        await _provider(
            lambda _request: httpx.Response(404), base_url="https://api.deepseek.com/v1"
        ).embed_documents(["查询"])
    assert "DeepSeek" in str(excinfo.value) and "不提供 embeddings 接口" in str(excinfo.value)
    assert "https://" not in str(excinfo.value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json={"object": "list"}),
        httpx.Response(200, json={"data": [{"object": "embedding"}]}),
    ],
)
async def test_bad_payloads_become_readable_embedding_error(response):
    with pytest.raises(EmbeddingError, match="格式非法"):
        await _provider(lambda _request: response).embed_documents(["查询"])


async def test_count_and_dimension_mismatch_raise_embedding_error():
    with pytest.raises(EmbeddingError, match="条数"):
        await _provider(lambda _request: _ok((0.1,) * 4)).embed_documents(["甲", "乙"])
    with pytest.raises(EmbeddingError, match="维度不符"):
        await _provider(lambda _request: _ok((0.1,) * 3)).embed_documents(["甲"])


async def test_oversize_response_is_rejected():
    from app.services.rag.rag_embedding_endpoint import MAX_RESPONSE_BYTES

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1))

    with pytest.raises(EmbeddingError, match="16MB"):
        await _provider(handler).embed_documents(["甲"])


# ===== 探测 / 私网矩阵 =====


async def test_probe_dim_uses_transport_not_spec_dim():
    def handler(_request: httpx.Request) -> httpx.Response:
        return _ok((0.1,) * 6)

    provider = _provider(handler, spec=_spec(dim=2))
    assert await provider.probe_dim() == 6  # 探测读回真实维度，不看 spec.dim=2


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("localhost", ADDRESS_LOOPBACK),
        ("printer.localhost", ADDRESS_LOOPBACK),
        ("127.0.0.1", ADDRESS_LOOPBACK),
        ("::1", ADDRESS_LOOPBACK),
        ("10.0.0.5", ADDRESS_PRIVATE),
        ("192.168.1.10", ADDRESS_PRIVATE),
        ("100.64.0.1", ADDRESS_SHARED),
        ("8.8.8.8", None),
        ("api.openai.com", None),
        ("", ADDRESS_INVALID),
    ],
)
def test_endpoint_class_matrix(host, expected):
    assert endpoint_class(host) == expected


@pytest.mark.parametrize(
    ("url", "allow_private", "allowed"),
    [
        ("http://127.0.0.1:11434/v1", False, False),
        ("http://127.0.0.1:11434/v1", True, True),
        ("http://localhost:11434/v1", False, False),
        ("http://localhost:11434/v1", True, True),
        ("http://10.0.0.5:11434/v1", False, False),
        ("http://10.0.0.5:11434/v1", True, True),
        ("https://8.8.8.8/v1", False, True),
        ("https://api.example.com/v1", False, True),
    ],
)
def test_private_endpoint_policy_matrix(url, allow_private, allowed):
    provider_kwargs: dict[str, Any] = {"allow_private": allow_private}
    try:
        provider = _provider(lambda _request: _ok((0.1,) * 4), base_url=url, **provider_kwargs)
    except EmbeddingError:
        assert not allowed, url
    else:
        assert allowed, url
        assert provider.base_url == url


async def test_aclose_only_closes_injected_client():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _r: _ok((0.1,) * 4)))
    provider = OpenAIHttpEmbeddingProvider(
        _spec(), base_url="https://api.example.com/v1", client=client
    )
    await provider.aclose()
    assert client.is_closed is True


# ===== 与 Lead 工厂的接线（契约 §6：create_embedding_provider 按 provider 派发） =====


def test_lead_factory_dispatches_to_remote_providers(monkeypatch):
    from dataclasses import replace

    from app.services.llm import embedding_settings, embeddings
    from app.services.llm.embedding_settings import EmbeddingProviderConfig

    def _config(**changes):
        return replace(
            EmbeddingProviderConfig(
                provider="openai-http",
                enabled=True,
                model="remote-model",
                dim=4,
                pooling="server",
                normalize=False,
                base_url="https://api.example.com/v1",
                api_key="dummy",
                batch_size=7,
            ),
            **changes,
        )

    monkeypatch.setattr(embedding_settings, "read_embedding_config", lambda **_k: _config())
    monkeypatch.setattr(embedding_settings, "is_host_confirmed", lambda _config: True)
    provider = embeddings.create_embedding_provider(_spec())
    assert isinstance(provider, OpenAIHttpEmbeddingProvider)
    assert provider.batch_size == 7
    monkeypatch.setattr(
        embedding_settings,
        "read_embedding_config",
        lambda **_k: _config(
            endpoint_mode="template",
            request_url="https://api.example.com/embed",
            body_template='{"texts": {texts}}',
            response_path="embeddings",
        ),
    )
    assert isinstance(embeddings.create_embedding_provider(_spec()), TemplateHttpEmbeddingProvider)
