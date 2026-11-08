# SPDX-License-Identifier: Apache-2.0
"""自定义端点模板（RAG v3 §4.7 路径 A）：字面替换、极简 response_path、安全边界。

全离线：MockTransport 回放响应，不联网、不调真实 LLM。钉住任务书 §6 的模板清单：
占位符只替换不执行、{texts} 缺失报错、>8KB 拒绝、response_path 只解析极简子集、
两种响应形态（向量二维数组 + 对象数组取字段）、条数不符报错、响应体超限拒绝，
以及"渲染后的 header（含 key）不出现在任何异常/日志里"。
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from app.services.llm import retry
from app.services.llm.embeddings import EmbeddingError, EmbeddingModelSpec
from app.services.llm.embeddings_http import TemplateHttpEmbeddingProvider
from app.services.rag.rag_embedding_endpoint import (
    MAX_RESPONSE_BYTES,
    MAX_TEMPLATE_BYTES,
    TemplateError,
    parse_response,
    render_body,
    render_headers,
    validate_template,
)

_TEMPLATE = '{"model": {model}, "texts": {texts}}'
_SECRET = "dummy-secret-value"


def _config(**overrides):
    values = {
        "provider": "openai-http",
        "endpoint_mode": "template",
        "request_url": "https://api.example.com/embed",
        "headers": ({"name": "Authorization", "value": "Bearer {api_key}"},),
        "body_template": _TEMPLATE,
        "response_path": "embeddings",
        "batch_size": 2,
        "api_key": _SECRET,
        "allow_private": False,
        "query_prefix": "",
        "doc_prefix": "",
        "normalize": False,
        "pooling": "server",
        "model": "template-model",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _spec(dim: int = 4) -> EmbeddingModelSpec:
    return EmbeddingModelSpec("openai-http", "template-model", dim, "server", normalize=False)


def _make_provider(handler, *, config=None, dim=4):
    return TemplateHttpEmbeddingProvider(
        _spec(dim),
        config=config or _config(),
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


def _vectors_handler(captured: list[httpx.Request], *, shape: str = "embeddings"):
    """按请求体里的 texts 条数返回等长向量；记录请求。"""

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        body = json.loads(request.content)
        texts = body.get("texts") or body.get("input") or []
        vectors = [[float(index + 1), 0.0, 0.0, 1.0] for index, _text in enumerate(texts)]
        if shape == "template":
            return httpx.Response(200, json={"embeddings": vectors})
        return httpx.Response(200, json={"data": [{"embedding": vector} for vector in vectors]})

    return handler


@pytest.fixture
def fake_sleep(monkeypatch):
    async def _sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(retry, "retry_sleep", _sleep)


# ===== 渲染 =====


def test_render_body_replaces_texts_and_model_as_json():
    body = render_body(_TEMPLATE, texts=["第一条", "第二条"], model="m1")
    parsed = json.loads(body)
    assert parsed == {"model": "m1", "texts": ["第一条", "第二条"]}


def test_render_body_supports_quoted_model_convention():
    rendered = render_body('{"model": "{model}", "input": {texts}}', texts=["a"], model="m2")
    assert json.loads(rendered) == {"model": "m2", "input": ["a"]}


def test_render_body_is_pure_literal_replacement_not_execution():
    marker = "SAFE"
    rendered = render_body(
        '{"model": {model}, "texts": {texts}, "x": "' + marker + '"}',
        texts=["{texts.__class__}"],
        model="m",
    )
    assert json.loads(rendered)["x"] == marker


@pytest.mark.parametrize(
    "template",
    [
        '{"model": {model}}',  # 缺 {texts}
        '{"model": {model}, "texts": {texts}, "evil": {__import__}}',  # 未知占位符
        '{"model": {model}, "texts": {texts}, "evil": {texts.__class__}}',  # 表达式外形
    ],
)
def test_bad_templates_are_rejected_with_readable_errors(template):
    with pytest.raises(TemplateError):
        validate_template(body_template=template, response_path="embeddings")


def test_oversize_template_is_rejected():
    template = '{"texts": {texts}, "pad": "' + "x" * MAX_TEMPLATE_BYTES + '"}'
    with pytest.raises(TemplateError, match="8"):
        render_body(template, texts=["a"], model="m")


def test_valid_template_passes_and_rejects_bad_response_paths():
    validate_template(body_template=_TEMPLATE, response_path="data[*].embedding")
    for bad_path in ("", "$.data", "data[*].embedding[0]", "a[*].b[*].c", "a-b"):
        with pytest.raises(TemplateError):
            validate_template(body_template=_TEMPLATE, response_path=bad_path)


# ===== header =====


def test_render_headers_substitutes_api_key():
    headers = render_headers([{"name": "Authorization", "value": "Bearer {api_key}"}], _SECRET)
    assert headers == {"Authorization": "Bearer " + _SECRET}


def test_render_headers_omits_empty_rendered_values():
    # api_key 未填时的 "Bearer {api_key}" 渲染成 "Bearer "：不能发尾随空格的 header
    # （h11 会报 Illegal header value，最终被误报成"无法连接"）。
    assert render_headers([{"name": "Authorization", "value": "Bearer {api_key}"}], "") == {}
    assert render_headers([{"name": "X-Empty", "value": "  "}], "") == {}


@pytest.mark.parametrize(
    "headers",
    [
        [{"name": "X-Bad", "value": "a\r\nInjected: 1"}],
        [{"name": "X-Bad", "value": "a\nInjected: 1"}],
        [{"name": "名称", "value": "v"}],
        [{"name": "", "value": "v"}],
    ],
)
def test_bad_headers_are_rejected(headers):
    with pytest.raises(TemplateError):
        render_headers(headers, _SECRET)


# ===== response_path 解析 =====


def test_parse_response_supports_2d_vector_array():
    vectors = parse_response({"embeddings": [[1, 2], [3, 4]]}, "embeddings", expected=2)
    assert vectors == ((1.0, 2.0), (3.0, 4.0))


def test_parse_response_supports_object_array_with_field():
    payload = {"data": [{"embedding": [1, 2]}, {"embedding": [3, 4]}]}
    assert parse_response(payload, "data[*].embedding", expected=2) == ((1.0, 2.0), (3.0, 4.0))


def test_parse_response_supports_nested_2d_and_array_marker_tail():
    nested = {"result": {"embeddings": [[1, 2], [3, 4]]}}
    assert parse_response(nested, "result.embeddings", expected=2) == ((1.0, 2.0), (3.0, 4.0))
    assert parse_response({"embeddings": [[5, 6]]}, "embeddings[*]", expected=1) == ((5.0, 6.0),)


def test_parse_response_rejects_wrong_shape_and_count():
    with pytest.raises(TemplateError, match="条数"):
        parse_response({"embeddings": [[1, 2]]}, "embeddings", expected=2)
    with pytest.raises(TemplateError):
        parse_response({"embeddings": [["not-a-number"]]}, "embeddings", expected=1)
    with pytest.raises(TemplateError):
        parse_response({"other": []}, "embeddings", expected=1)


# ===== provider 集成（MockTransport） =====


async def test_template_provider_renders_request_and_parses_response():
    captured: list[httpx.Request] = []
    provider = _make_provider(_vectors_handler(captured, shape="template"))
    batch = await provider.embed_documents(["甲", "乙", "丙"])
    assert len(batch.vectors) == 3 and all(len(vector) == 4 for vector in batch.vectors)
    assert [len(json.loads(request.content)["texts"]) for request in captured] == [2, 1]
    assert captured[0].headers["authorization"] == "Bearer " + _SECRET
    assert captured[0].url == "https://api.example.com/embed"


async def test_template_provider_supports_data_embedding_shape():
    captured: list[httpx.Request] = []
    provider = _make_provider(
        _vectors_handler(captured, shape="data"),
        config=_config(response_path="data[*].embedding"),
    )
    batch = await provider.embed_documents(["甲"])
    assert batch.vectors == ((1.0, 0.0, 0.0, 1.0),)


async def test_template_provider_rejects_count_mismatch_without_leaking_key():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"embeddings": [[1.0, 0.0, 0.0, 1.0]]})

    provider = _make_provider(handler)
    with pytest.raises(EmbeddingError, match="条数"):
        await provider.embed_documents(["甲", "乙"])
    try:
        await _make_provider(handler).embed_documents(["甲", "乙"])
    except EmbeddingError as exc:
        assert _SECRET not in str(exc)


async def test_template_provider_bad_json_and_http_error_do_not_leak_key(fake_sleep):
    def bad_json(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"embeddings": [')

    with pytest.raises(EmbeddingError, match="合法 JSON"):
        await _make_provider(bad_json).embed_documents(["甲"])

    def server_error(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with pytest.raises(EmbeddingError) as excinfo:
        await _make_provider(server_error).embed_documents(["甲"])
    assert _SECRET not in str(excinfo.value)
    assert "api.example.com" not in str(excinfo.value)


async def test_template_provider_rejects_oversize_response():
    def huge(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1))

    with pytest.raises(EmbeddingError, match="16MB"):
        await _make_provider(huge).embed_documents(["甲"])


def test_provider_construction_reports_bad_template_without_key():
    config = _config(body_template='{"model": {model}}')
    with pytest.raises(EmbeddingError, match="{texts}"):
        _make_provider(lambda _request: httpx.Response(200), config=config)
    try:
        _make_provider(lambda _request: httpx.Response(200), config=config)
    except EmbeddingError as exc:
        assert _SECRET not in str(exc)
