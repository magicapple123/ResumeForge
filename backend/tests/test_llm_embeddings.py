# SPDX-License-Identifier: Apache-2.0
"""Embedding 能力测试（RAG v2 §2.3/§3.4）：全离线，无真实网络/LLM/数据库。

钉住：模型指纹随 dim/pooling/prefix 变化；Fake 确定性且跨进程同向量；Http 的 200 解析、
429 重试、5xx 终态、坏 JSON、维度不符、超时；真取消原样传播；预算耗尽不发起请求；capability 不变。
"""

import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from app.runtime.operation_budget import OperationBudget
from app.schemas.setting import LLMConfig
from app.services.llm import embeddings as embeddings_module
from app.services.llm import retry
from app.services.llm.capabilities import ProviderCapabilities, resolve_capabilities
from app.services.llm.embeddings import (
    EmbeddingBatch,
    EmbeddingError,
    EmbeddingModelSpec,
    FakeEmbeddingProvider,
    HttpEmbeddingProvider,
    create_embedding_provider,
    resolve_embedding_spec,
)


def _spec(**overrides) -> EmbeddingModelSpec:
    values = {
        "provider": "fake",
        "model": "fake-embedding-v1",
        "dim": 8,
        "pooling": "mean",
        "query_prefix": "",
        "doc_prefix": "",
        "normalize": True,
    }
    values.update(overrides)
    return EmbeddingModelSpec(**values)


def _settings(**overrides) -> SimpleNamespace:
    values = {
        "rag_embedding_provider": "fake",
        "rag_embedding_model": "fake-embedding-v1",
        "rag_embedding_dim": 8,
        "rag_embedding_pooling": "mean",
        "rag_embedding_query_prefix": "",
        "rag_embedding_doc_prefix": "",
        "rag_embedding_normalize": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _response(*vectors: tuple[float, ...]) -> httpx.Response:
    return httpx.Response(200, json={"data": [{"embedding": list(v)} for v in vectors]})


def _transport(responses: list[httpx.Response]):
    """按顺序回放响应并记录请求次数（用尽后重复最后一个）。"""
    state = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["count"] += 1
        return responses[min(state["count"], len(responses)) - 1]

    return handler, state


def _http_provider(handler, spec: EmbeddingModelSpec | None = None) -> HttpEmbeddingProvider:
    return HttpEmbeddingProvider(
        spec or _spec(provider="http", normalize=False),
        base_url="https://api.example.com/v1",
        api_key="secret",
        timeout=5.0,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


@pytest.fixture
def fake_sleep(monkeypatch):
    """注入时钟：记录退避秒数，不真睡。"""
    delays: list[float] = []

    async def _sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr(retry, "retry_sleep", _sleep)
    return delays


def test_spec_fingerprint_changes_when_model_properties_change():
    base = _spec().fingerprint()
    assert len(base) == 64
    assert _spec().fingerprint() == base
    for change in (
        {"dim": 16},
        {"pooling": "last-token"},
        {"query_prefix": "Instruct: 检索\nQuery:"},
    ):
        assert _spec(**change).fingerprint() != base, change


def test_resolve_embedding_spec_and_factory(monkeypatch):
    spec = resolve_embedding_spec(
        settings=_settings(rag_embedding_query_prefix="Q:", rag_embedding_dim=16)
    )
    assert spec is not None
    assert (spec.provider, spec.dim, spec.query_prefix, spec.normalize) == ("fake", 16, "Q:", True)
    for provider in ("", "none", "NONE", " disabled ", None):
        assert resolve_embedding_spec(settings=_settings(rag_embedding_provider=provider)) is None
    monkeypatch.setattr(
        embeddings_module, "get_settings", lambda: _settings(rag_embedding_model="m2")
    )
    default_spec = resolve_embedding_spec()
    assert default_spec is not None and default_spec.model == "m2"
    assert isinstance(create_embedding_provider(default_spec), FakeEmbeddingProvider)
    assert create_embedding_provider(_spec(provider="openai")) is None


async def test_fake_is_deterministic_dimensioned_and_normed():
    provider = FakeEmbeddingProvider(_spec())
    first = await provider.embed_documents(["张三", "项目经验"])
    second = await FakeEmbeddingProvider(_spec()).embed_documents(["张三", "项目经验"])
    assert first.vectors == second.vectors  # 跨实例（=跨进程）同文本同向量
    assert len(first.vectors) == 2 and all(len(vector) == 8 for vector in first.vectors)
    assert first.vectors[0] != first.vectors[1]
    assert (first.model, first.dim, first.retries) == ("fake-embedding-v1", 8, 0)
    assert abs(sum(value * value for value in first.vectors[0]) - 1.0) < 1e-9
    raw = await FakeEmbeddingProvider(_spec(normalize=False)).embed_query("经验")
    assert abs(sum(value * value for value in raw) - 1.0) > 1e-3
    usage = provider.last_usage
    assert usage is not None
    assert (usage.model, usage.prompt_tokens, usage.finish_reason) == (
        "fake-embedding-v1",
        None,
        "stop",
    )


async def test_fake_query_vector_is_pinned_across_processes():
    """跨进程确定性钉子：实现改了就红，必须显式确认新向量与新索引。"""
    vector = await FakeEmbeddingProvider(_spec()).embed_query("简历")
    assert vector == (
        0.2734175583923352,
        0.23267637586314752,
        0.020065781184723464,
        -0.6241286994681433,
        0.34769543265711134,
        0.11491524307902778,
        0.3948473502993452,
        -0.4372221595283963,
    )


async def test_prefixes_are_applied_per_kind():
    plain = FakeEmbeddingProvider(_spec(normalize=False))
    doc_prefixed = FakeEmbeddingProvider(_spec(normalize=False, doc_prefix="文档："))
    assert (await plain.embed_documents(["后端"])).vectors != (
        await doc_prefixed.embed_documents(["后端"])
    ).vectors
    # doc_prefix 不作用于 query：同 query 文本在带/不带 doc_prefix 时向量相同。
    assert (await doc_prefixed.embed_query("后端")) == (await plain.embed_query("后端"))
    query_spec = _spec(normalize=False, query_prefix="查询：")
    assert (await FakeEmbeddingProvider(query_spec).embed_query("后端")) != (
        await FakeEmbeddingProvider(query_spec).embed_documents(["后端"])
    ).vectors[0]


async def test_empty_texts_are_rejected_and_usage_records_error():
    provider = FakeEmbeddingProvider(_spec())
    with pytest.raises(EmbeddingError, match="不能为空"):
        await provider.embed_query("   ")
    with pytest.raises(EmbeddingError, match="不能为空"):
        await provider.embed_documents([])
    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "error"


async def test_http_200_parses_openai_embedding_payload():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return _response((0.1,) * 8, (0.2,) * 8)

    batch = await _http_provider(handler).embed_documents(["第一条", "第二条"])
    assert batch.vectors == ((0.1,) * 8, (0.2,) * 8)
    assert (batch.model, batch.dim, batch.retries) == ("fake-embedding-v1", 8, 0)
    assert requests[0].url == "https://api.example.com/v1/embeddings"
    assert requests[0].headers["authorization"] == "Bearer secret"
    body = json.loads(requests[0].content)
    assert (body["model"], body["input"]) == ("fake-embedding-v1", ["第一条", "第二条"])


async def test_http_429_retries_then_succeeds(fake_sleep):
    handler, state = _transport(
        [httpx.Response(429, headers={"Retry-After": "1"}), _response((0.5,) * 8)]
    )
    batch = await _http_provider(handler).embed_documents(["查询"])
    assert batch.vectors == ((0.5,) * 8,)
    assert (state["count"], batch.retries, fake_sleep) == (2, 1, [1.0])


async def test_http_5xx_exhausts_retry_into_embedding_error(fake_sleep):
    handler, state = _transport([httpx.Response(500), httpx.Response(500)])
    with pytest.raises(EmbeddingError, match="已自动重试 1 次"):
        await _http_provider(handler).embed_documents(["查询"])
    assert (state["count"], fake_sleep) == (2, [1.0])


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"object": "list"}),
        httpx.Response(200, json={"data": [{"object": "embedding"}]}),
    ],
)
async def test_http_bad_payloads_become_embedding_error(response):
    handler, _ = _transport([response])
    with pytest.raises(EmbeddingError):
        await _http_provider(handler).embed_documents(["查询"])


async def test_http_dimension_mismatch_becomes_embedding_error():
    handler, _ = _transport([_response((0.1,) * 4)])
    with pytest.raises(EmbeddingError, match="维度不符"):
        await _http_provider(handler).embed_documents(["查询"])


async def test_http_transport_timeout_becomes_embedding_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout", request=request)

    with pytest.raises(EmbeddingError, match="超时"):
        await _http_provider(handler).embed_documents(["查询"])


async def test_budget_exhaustion_skips_request_and_hard_wall_times_out():
    handler, state = _transport([_response((0.1,) * 8)])
    expired = OperationBudget(deadline=time.monotonic() - 1.0)
    with pytest.raises(EmbeddingError, match="预算"):
        await _http_provider(handler).embed_documents(["查询"], budget=expired)
    assert state["count"] == 0

    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(10)
        return _response((0.1,) * 8)

    with pytest.raises(EmbeddingError, match="超时|预算"):
        await _http_provider(slow).embed_documents(["查询"], budget=OperationBudget.start(0.05))


@pytest.mark.parametrize(
    "base_url", ["https://127.0.0.1:8080/v1", "https://10.0.0.7/v1", "https://[::1]/v1"]
)
def test_http_provider_rejects_non_public_ip_literal(base_url):
    with pytest.raises(EmbeddingError, match="非公网"):
        HttpEmbeddingProvider(_spec(provider="http"), base_url=base_url, api_key="k", timeout=5.0)


async def test_asyncio_cancellation_propagates_unchanged():
    entered = asyncio.Event()

    class _HangingProvider(FakeEmbeddingProvider):
        async def _embed_prefixed(self, texts, *, budget=None):
            entered.set()
            await asyncio.sleep(30)
            return EmbeddingBatch((), self.spec.model, self.spec.dim, 0)

    provider = _HangingProvider(_spec())
    task = asyncio.create_task(provider.embed_query("查询"))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert provider.last_usage is not None
    assert provider.last_usage.finish_reason == "cancelled"


def test_capabilities_embeddings_declaration_keeps_existing_behavior():
    config = LLMConfig(base_url="https://api.deepseek.com/v1", api_key="k", model="deepseek-flash")
    capabilities = resolve_capabilities(config)
    assert (capabilities.embeddings, capabilities.tools, capabilities.stream) == (False, True, True)
    assert (capabilities.structured_output, capabilities.vision) == (False, False)
    # 老调用方按关键字构造不传新字段也能工作（默认 False），既有行为不变。
    legacy = ProviderCapabilities(
        tools=True, structured_output=False, stream=True, vision=False, reasoning=False
    )
    assert legacy.embeddings is False
