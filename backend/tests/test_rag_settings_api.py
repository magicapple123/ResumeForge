# SPDX-License-Identifier: Apache-2.0
"""RAG v3 语义检索设置端点：状态机、本地/远程启用、隐私确认、清除密钥。"""

from __future__ import annotations

import json
import sys
from types import SimpleNamespace

import pytest
from app.api import settings_embedding
from app.services import global_settings
from app.services.llm.embedding_settings import (
    KEY_MASK,
    EmbeddingProviderConfig,
    read_embedding_config,
    write_embedding_config,
)
from app.services.rag.rag_index import reset_rag_index

SECRET = "api-endpoint-test-key-value"
REMOTE = {
    "provider": "openai-http",
    "base_url": "https://api.example.com/v1",
    "model": "mock-embed",
    "api_key": SECRET,
    "batch_size": 25,
}


class FakeLocalApi:
    def __init__(self) -> None:
        self.ready = False
        self.started = False
        self.cancelled = False

    def local_status(self) -> dict:
        state = "ready" if self.ready else "not_downloaded"
        return {
            "supported": True,
            "platform": "windows-x64",
            "variant": "int8_avx2",
            "download_bytes": 161000000,
            "state": state,
            "progress": 1.0 if self.ready else 0.0,
            "error": "",
            "model": "granite-embedding-97m-multilingual-r2",
            "runtime_version": "1.31.1",
        }

    def start_local_setup(self) -> None:
        self.started = True

    def cancel_local_setup(self) -> None:
        self.cancelled = True

    def remove_local_assets(self) -> None:
        self.ready = False

    def activate_local(self) -> None:
        if not self.ready:
            raise RuntimeError("本地模型文件缺失")
        write_embedding_config(
            EmbeddingProviderConfig(
                provider="local-onnx",
                enabled=True,
                model="granite-embedding-97m-multilingual-r2",
                dim=384,
                pooling="cls",
                variant="int8_avx2",
            )
        )


class FakeRemoteApi:
    def __init__(self) -> None:
        self.ok = True
        self.error = ""

    async def probe_remote(self, config):  # noqa: ANN001, ANN201
        del config
        return SimpleNamespace(
            ok=self.ok, dim=16, elapsed_ms=12, model="mock-embed", error=self.error
        )

    async def fetch_models(self, config):  # noqa: ANN001, ANN201
        del config
        return ["mock-embed", "mock-embed-large"]


class FakeIndex:
    def __init__(self) -> None:
        self.cleared = 0

    def clear(self) -> None:
        self.cleared += 1


@pytest.fixture(autouse=True)
def _clean_state():
    global_settings.path().unlink(missing_ok=True)
    reset_rag_index()
    yield
    global_settings.path().unlink(missing_ok=True)


@pytest.fixture
def local_api(monkeypatch):
    fake = FakeLocalApi()
    monkeypatch.setattr(settings_embedding, "_local_api", lambda: fake)
    monkeypatch.setattr(settings_embedding, "_runtime_available", lambda local: fake.ready)
    return fake


@pytest.fixture
def remote_api(monkeypatch):
    fake = FakeRemoteApi()
    monkeypatch.setattr(settings_embedding, "_remote_api", lambda: fake)
    return fake


@pytest.fixture
def index_spy(monkeypatch):
    spy = FakeIndex()
    monkeypatch.setattr(settings_embedding, "get_rag_index", lambda: spy)
    return spy


def _status(client) -> dict:
    response = client.get("/api/settings/embedding/status")
    assert response.status_code == 200
    return response.json()


def test_status_defaults_to_not_configured(client, local_api):
    body = _status(client)
    assert body["state"] == "not_configured"
    assert body["provider"] == ""
    assert body["local"]["supported"] is True
    assert body["remote"]["configured"] is False
    assert body["config"] is None
    assert set(body) >= {"state", "provider", "last_error", "local", "remote", "runtime"}


def test_local_download_rejected_when_platform_unsupported(client, monkeypatch):
    fake = FakeLocalApi()
    fake.local_status = lambda: {**FakeLocalApi().local_status(), "supported": False}
    monkeypatch.setattr(settings_embedding, "_local_api", lambda: fake)
    response = client.post("/api/settings/embedding/local/download")
    assert response.status_code == 400
    assert "平台" in response.json()["detail"]


def test_local_download_and_enable_flow(client, local_api, index_spy):
    assert client.post("/api/settings/embedding/local/download").status_code == 200
    assert local_api.started is True

    failed = client.post("/api/settings/embedding/local/enable")
    assert failed.status_code == 400
    assert "缺失" in failed.json()["detail"]

    local_api.ready = True
    response = client.post("/api/settings/embedding/local/enable")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "ready" and body["provider"] == "local-onnx"
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.enabled and config.variant == "int8_avx2"
    assert index_spy.cleared >= 1, "启用新 provider 必须清空旧索引"


def test_local_remove_resets_provider_to_unconfigured(client, local_api):
    """删除下载文件必须回到"未配置"，不能留下 provider=local-onnx 的半配置态。"""
    local_api.ready = True
    assert client.post("/api/settings/embedding/local/enable").status_code == 200
    response = client.post("/api/settings/embedding/local/remove")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "not_configured"
    assert body["provider"] == ""
    assert body["local"]["state"] == "not_downloaded"
    assert read_embedding_config() is None


def test_remote_enable_requires_host_confirmation(client, remote_api, index_spy):
    response = client.post("/api/settings/embedding/remote/enable", json=REMOTE)
    assert response.status_code == 400
    assert "确认" in response.json()["detail"]

    confirm = client.post(
        "/api/settings/embedding/remote/confirm", json={"base_url": REMOTE["base_url"]}
    )
    assert confirm.status_code == 200
    assert confirm.json()["confirmed_hosts"] == ["api.example.com"]

    response = client.post("/api/settings/embedding/remote/enable", json=REMOTE)
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "ready" and body["provider"] == "openai-http"
    assert body["remote"]["dim"] == 16 and body["remote"]["host"] == "api.example.com"
    assert body["config"]["api_key"] == KEY_MASK
    raw = global_settings.path().read_text(encoding="utf-8")
    # 落盘形态随平台：Windows 走 DPAPI 密文，其它平台（无 DPAPI）按设计就是明文
    # （api_key_crypto 模块文档 §RF-24，与 test_global_llm 同一口径）。
    if sys.platform == "win32":
        assert SECRET not in raw
    else:
        assert SECRET in raw
    assert index_spy.cleared >= 1


def test_remote_probe_failure_does_not_pollute_current_config(client, remote_api):
    """切换/启用失败不能污染当前生效配置：旧版会写 last_error 让状态变 failed。"""
    client.post("/api/settings/embedding/remote/confirm", json={"base_url": REMOTE["base_url"]})
    assert client.post("/api/settings/embedding/remote/enable", json=REMOTE).status_code == 200
    before = read_embedding_config(reveal_key=True)
    remote_api.ok = False
    remote_api.error = "凭据无效（HTTP 401），请检查密钥"
    response = client.post("/api/settings/embedding/remote/enable", json=REMOTE)
    assert response.status_code == 400
    assert "401" in response.json()["detail"]
    body = _status(client)
    assert body["state"] == "ready"
    assert body["last_error"] == ""
    after = read_embedding_config(reveal_key=True)
    assert after is not None and before is not None
    assert (after.base_url, after.model, after.api_key, after.enabled) == (
        before.base_url, before.model, before.api_key, True,
    )


def test_remote_models_and_test_connection(client, remote_api):
    test_body = client.post("/api/settings/embedding/remote/test", json=REMOTE).json()
    assert test_body["ok"] is True and test_body["dim"] == 16
    models = client.post("/api/settings/embedding/remote/models", json=REMOTE)
    assert models.status_code == 200
    assert models.json()["models"] == ["mock-embed", "mock-embed-large"]


def test_clear_key_keeps_profiles_but_disables(client, remote_api, index_spy):
    """「清除密钥」= 只清当前生效项的密钥并停用，不再把全部命名配置一起删掉。"""
    client.post("/api/settings/embedding/remote/confirm", json={"base_url": REMOTE["base_url"]})
    assert client.post("/api/settings/embedding/remote/enable", json=REMOTE).status_code == 200
    cleared_before = index_spy.cleared

    response = client.post("/api/settings/embedding/clear")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "disabled"
    assert len(body["profiles"]) == 1
    assert body["profiles"][0]["key_configured"] is False
    assert index_spy.cleared > cleared_before
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.enabled is False and config.api_key == ""
    raw = json.loads(global_settings.path().read_text(encoding="utf-8"))
    assert raw["embedding_profiles"]["profiles"], "配置文件应保留（只清密钥）"


def test_disable_keeps_configuration_but_stops_provider(client, remote_api):
    client.post("/api/settings/embedding/remote/confirm", json={"base_url": REMOTE["base_url"]})
    assert client.post("/api/settings/embedding/remote/enable", json=REMOTE).status_code == 200
    response = client.post("/api/settings/embedding/disable")
    body = response.json()
    assert body["state"] == "disabled"
    assert body["remote"]["configured"] is True
    assert body["remote"]["host"] == "api.example.com"
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.enabled is False


def test_revoke_confirmation_disables_provider(client, remote_api):
    client.post("/api/settings/embedding/remote/confirm", json={"base_url": REMOTE["base_url"]})
    assert client.post("/api/settings/embedding/remote/enable", json=REMOTE).status_code == 200
    response = client.post(
        "/api/settings/embedding/remote/confirm/revoke", json={"host": "api.example.com"}
    )
    assert response.status_code == 200
    assert response.json()["confirmed_hosts"] == []
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.enabled is False


def test_template_validation_error_is_readable(client, remote_api, monkeypatch):
    def _boom(body_template: str, response_path: str) -> None:
        del body_template, response_path
        raise ValueError("请求体模板缺少 {texts} 占位符")

    monkeypatch.setattr(settings_embedding, "_validate_template", _boom)
    payload = {
        "provider": "openai-http",
        "model": "m",
        "endpoint_mode": "template",
        "request_url": "https://api.example.com/embed",
        "body_template": "{}",
        "response_path": "embeddings",
    }
    response = client.post("/api/settings/embedding/remote/test", json=payload)
    assert response.status_code == 400
    assert "{texts}" in response.json()["detail"]


def test_non_loopback_client_cannot_write_settings(client, monkeypatch):
    monkeypatch.setattr("app.api.settings._is_loopback_request", lambda _request: False)
    response = client.post(
        "/api/settings/embedding/remote/confirm", json={"base_url": REMOTE["base_url"]}
    )
    assert response.status_code == 403
