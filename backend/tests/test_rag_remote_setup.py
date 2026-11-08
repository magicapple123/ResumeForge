# SPDX-License-Identifier: Apache-2.0
"""远程设置期服务（RAG v3 §4.2）：探测维度、模型列表、/status.remote 组装。

全离线：MockTransport 回放响应。钉住"探测成功不暴露 dim / 探测失败退回手填"的协议侧：
probe_remote 返回 ok/dim/elapsed_ms/model/error 且 dim 来自真实响应（不依赖 config.dim）、
失败不抛异常但给可读原因、私网端点默认拒绝/显式允许后放行、fetch_models 任何失败返回 []、
remote_status 字段齐全且不含密钥。
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from app.services.llm import retry
from app.services.rag import rag_remote_setup
from app.services.rag.rag_remote_setup import (
    ProbeResult,
    fetch_models,
    probe_remote,
    remote_status,
)

_SECRET = "dummy-secret-value"
_LOOPBACK_BASE = "http://127.0.0.1:8123/v1"


def _config(**overrides) -> SimpleNamespace:
    values = {
        "provider": "openai-http",
        "enabled": True,
        "model": "mock-embedding-v1",
        "dim": 0,
        "pooling": "server",
        "query_prefix": "",
        "doc_prefix": "",
        "normalize": False,
        "base_url": "https://api.example.com/v1",
        "api_key": _SECRET,
        "batch_size": 25,
        "endpoint_mode": "openai",
        "request_url": "",
        "headers": (),
        "body_template": "",
        "response_path": "data[*].embedding",
        "allow_private": False,
        "confirmed_hosts": (),
        "last_error": "",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def fake_sleep(monkeypatch):
    async def _sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(retry, "retry_sleep", _sleep)


def _embeddings_handler(dim: int = 16, captured: list[httpx.Request] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(request)
        body = json.loads(request.content)
        vectors = [[0.1] * dim for _ in body["input"]]
        return httpx.Response(200, json={"data": [{"embedding": vector} for vector in vectors]})

    return handler


def _template_handler(dim: int = 8):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["texts"]
        return httpx.Response(200, json={"embeddings": [[0.2] * dim for _ in body["texts"]]})

    return handler


# ===== probe_remote =====


async def test_probe_remote_returns_transport_dim_not_config_dim():
    captured: list[httpx.Request] = []
    config = _config(dim=99)
    result = await probe_remote(config, client=_client(_embeddings_handler(16, captured)))
    assert isinstance(result, ProbeResult)
    assert (result.ok, result.dim, result.model, result.error) == (
        True,
        16,
        "mock-embedding-v1",
        "",
    )
    assert result.elapsed_ms >= 0
    assert captured and len(captured) == 1  # 只发 1 条短文本探测


@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, "API Key 无效"), (403, "无权限"), (500, "内部错误")],
)
async def test_probe_remote_failures_are_readable_results_not_exceptions(
    status, expected, fake_sleep
):
    config = _config()
    result = await probe_remote(config, client=_client(lambda _request: httpx.Response(status)))
    assert result.ok is False and result.dim == 0
    assert expected in result.error
    assert _SECRET not in result.error


async def test_probe_remote_network_error_is_readable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    result = await probe_remote(_config(), client=_client(handler))
    assert result.ok is False
    assert "无法连接" in result.error
    assert "boom" not in result.error


async def test_probe_remote_template_mode_uses_rendered_request():
    config = _config(
        endpoint_mode="template",
        request_url="https://api.example.com/embed",
        headers=({"name": "Authorization", "value": "Bearer {api_key}"},),
        body_template='{"model": {model}, "texts": {texts}}',
        response_path="embeddings",
    )
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return _template_handler(8)(request)

    result = await probe_remote(config, client=_client(handler))
    assert (result.ok, result.dim) == (True, 8)
    body = json.loads(captured[0].content)
    assert body["model"] == "mock-embedding-v1"
    assert "texts" in body
    assert captured[0].url == "https://api.example.com/embed"


# ===== 私网开关（回环默认拒绝 / 显式允许后放行） =====


async def test_loopback_endpoint_is_blocked_by_default(monkeypatch):
    monkeypatch.setattr(rag_remote_setup, "_settings", lambda: None)
    config = _config(base_url=_LOOPBACK_BASE, allow_private=False)
    result = await probe_remote(config, client=_client(_embeddings_handler(4)))
    assert result.ok is False
    assert "非公网地址" in result.error and "loopback" in result.error


async def test_loopback_endpoint_is_allowed_when_explicitly_enabled():
    config = _config(base_url=_LOOPBACK_BASE, allow_private=True)
    result = await probe_remote(config, client=_client(_embeddings_handler(4)))
    assert (result.ok, result.dim) == (True, 4)
    assert result.error == ""


async def test_public_endpoint_is_unaffected_by_private_switch(monkeypatch):
    monkeypatch.setattr(rag_remote_setup, "_settings", lambda: None)
    config = _config(base_url="https://api.example.com/v1", allow_private=False)
    result = await probe_remote(config, client=_client(_embeddings_handler(4)))
    assert result.ok is True


# ===== fetch_models =====


async def test_fetch_models_returns_ids_and_sorts_dedupes_order():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.example.com/v1/models"
        assert request.headers["authorization"] == "Bearer " + _SECRET
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "b-model"},
                    {"id": "a-model"},
                    {"id": "b-model"},
                    {"id": ""},
                    {"not-an-id": 1},
                ]
            },
        )

    assert await fetch_models(_config(), client=_client(handler)) == ["b-model", "a-model"]


@pytest.mark.parametrize(
    "handler",
    [
        lambda _request: httpx.Response(500),
        lambda _request: httpx.Response(200, content=b"not json"),
        lambda _request: httpx.Response(200, json={"object": "list"}),
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("x", request=request)),
    ],
)
async def test_fetch_models_returns_empty_on_any_failure(handler):
    assert await fetch_models(_config(), client=_client(handler)) == []


async def test_fetch_models_template_mode_is_empty_and_private_blocked_is_empty(monkeypatch):
    monkeypatch.setattr(rag_remote_setup, "_settings", lambda: None)
    assert await fetch_models(_config(endpoint_mode="template")) == []
    blocked = _config(base_url=_LOOPBACK_BASE, allow_private=False)
    assert await fetch_models(blocked, client=_client(_embeddings_handler(4))) == []


# ===== remote_status =====


def _empty_remote() -> dict:
    return {
        "configured": False,
        "enabled": False,
        "host": "",
        "model": "",
        "dim": 0,
        "endpoint_mode": "openai",
        "batch_size": 25,
        "confirmed_hosts": [],
        "pending_host": "",
        "error": "",
    }


def test_remote_status_without_config_is_all_empty(monkeypatch):
    monkeypatch.setattr(rag_remote_setup, "_read_persisted_config", lambda: None)
    assert remote_status() == _empty_remote()


def test_remote_status_ignores_non_remote_providers():
    assert remote_status(_config(provider="local-onnx")) == _empty_remote()
    assert remote_status(_config(provider="fake")) == _empty_remote()


def test_remote_status_pending_host_until_confirmed():
    unconfirmed = remote_status(_config())
    assert unconfirmed["configured"] is True and unconfirmed["enabled"] is True
    assert unconfirmed["host"] == "api.example.com"
    assert unconfirmed["pending_host"] == "api.example.com"

    confirmed = remote_status(_config(confirmed_hosts=("api.example.com",)))
    assert confirmed["confirmed_hosts"] == ["api.example.com"]
    assert confirmed["pending_host"] == ""


def test_remote_status_template_uses_request_url_host_and_no_key():
    config = _config(
        endpoint_mode="template",
        base_url="",
        request_url="https://embed.example.com/v1/embed",
        model="custom-model",
        dim=1024,
        batch_size=8,
        last_error="上次探测失败",
    )
    status = remote_status(config)
    assert status["host"] == "embed.example.com"
    assert status["endpoint_mode"] == "template"
    assert status["model"] == "custom-model"
    assert status["dim"] == 1024 and status["batch_size"] == 8
    assert status["error"] == "上次探测失败"
    assert "api_key" not in status
    assert _SECRET not in json.dumps(status, ensure_ascii=False)
