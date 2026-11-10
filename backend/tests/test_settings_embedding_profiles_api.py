# SPDX-License-Identifier: Apache-2.0
"""
语义检索命名配置的 HTTP 端点（清单第 1/16 条）集成测试。

网络探测一律 stub：本机只有一份真实 DashScope 凭据，无法构造「三条都有真实密钥且可探测」
的配置。真实服务验证见交付说明中的实机步骤（迁移/切换/持久化用真实接口跑过）。
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from app.api import settings_embedding
from app.services import global_settings
from app.services.llm import embedding_activation
from app.services.llm.embedding_profiles import PROFILES_KEY
from app.services.llm.embedding_settings import KEY_MASK, encrypt_secret, read_embedding_config
from app.services.rag.rag_index import reset_rag_index

SECRET_A = "key-api-a"
SECRET_B = "key-api-b"

LOCAL_DISABLED = {
    "supported": True,
    "platform": "windows-x64",
    "variant": "int8_avx2",
    "download_bytes": 111308819,
    "state": "not_downloaded",
    "progress": 0.0,
    "error": "",
    "model": "",
    "runtime_version": "1.31.1",
}


class Probe:
    def __init__(self) -> None:
        self.ok = True
        self.error = ""
        self.calls: list = []

    async def __call__(self, config):  # noqa: ANN001, ANN204
        self.calls.append(config)
        return SimpleNamespace(
            ok=self.ok, dim=16 if self.ok else 0, elapsed_ms=4, model=config.model, error=self.error
        )


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    reset_rag_index()
    monkeypatch.setattr(settings_embedding, "_local_status", lambda: dict(LOCAL_DISABLED))
    monkeypatch.setattr(settings_embedding, "_runtime_available", lambda local: False)
    monkeypatch.setattr(embedding_activation, "_local_state", lambda: "")
    yield
    reset_rag_index()


@pytest.fixture
def probe(monkeypatch):
    fake = Probe()
    monkeypatch.setattr(embedding_activation, "_probe", fake)
    return fake


def _write_state(extra: dict) -> None:
    payload = {"version": 2, "llm": {"enabled": False, "active_profile_id": "", "profiles": []}}
    payload.update(extra)
    global_settings.path().write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _status(client) -> dict:
    response = client.get("/api/settings/embedding/status")
    assert response.status_code == 200
    return response.json()


def _create(
    client,
    name: str,
    *,
    key: str = "",
    base_url: str = "https://api.example.com/v1",
    model: str = "mock-embed",
):
    response = client.post(
        "/api/settings/embedding/profiles",
        json={
            "name": name,
            "config": {
                "base_url": base_url,
                "model": model,
                "api_key": key,
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["profile"]


def _confirm(client, base_url: str) -> None:
    assert (
        client.post(
            "/api/settings/embedding/remote/confirm", json={"base_url": base_url}
        ).status_code
        == 200
    )


def test_status_migrates_legacy_and_masks_profiles(client):
    _write_state(
        {
            "embedding": {
                "provider": "openai-http",
                "enabled": True,
                "model": "mock-embed",
                "dim": 16,
                "base_url": "https://api.example.com/v1",
                "api_key": encrypt_secret(SECRET_A),
                "confirmed_hosts": ["api.example.com"],
            }
        }
    )
    body = _status(client)
    assert body["state"] == "ready"
    assert len(body["profiles"]) == 1
    profile = body["profiles"][0]
    assert profile["name"] == "默认配置"
    assert profile["key_configured"] is True
    assert "api_key" not in json.dumps(profile)
    assert body["active_profile_id"] == profile["id"]
    assert body["config"]["api_key"] == KEY_MASK


def test_create_duplicate_conflict_and_name_rules(client):
    _create(client, "公司 Azure", key=SECRET_A)
    duplicate = client.post(
        "/api/settings/embedding/profiles",
        json={
            "name": "公司 Azure",
            "config": {"base_url": "https://api.example.com/v1", "model": "m", "api_key": ""},
        },
    )
    assert duplicate.status_code == 409
    long_name = client.post(
        "/api/settings/embedding/profiles",
        json={
            "name": "长" * 65,
            "config": {"base_url": "https://api.example.com/v1", "model": "m", "api_key": ""},
        },
    )
    assert long_name.status_code == 400


def test_profile_limit(client):
    for index in range(20):
        _create(client, f"配置 {index}", base_url=f"https://host{index}.example.com/v1")
    overflow = client.post(
        "/api/settings/embedding/profiles",
        json={
            "name": "第 21 条",
            "config": {"base_url": "https://api.example.com/v1", "model": "m", "api_key": ""},
        },
    )
    assert overflow.status_code == 400


def test_activate_switches_only_active_and_uses_own_key(client, probe):
    first = _create(client, "A", key=SECRET_A, base_url="https://a.example.com/v1")
    second = _create(client, "B", key=SECRET_B, base_url="https://b.example.com/v1")
    _confirm(client, "https://a.example.com/v1")
    _confirm(client, "https://b.example.com/v1")
    before_ids = [item["id"] for item in _status(client)["profiles"]]
    assert (
        client.post(f"/api/settings/embedding/profiles/{first['id']}/activate").status_code == 200
    )
    body = _status(client)
    assert body["state"] == "ready" and body["active_profile_id"] == first["id"]
    assert probe.calls[-1].api_key == SECRET_A
    assert (
        client.post(f"/api/settings/embedding/profiles/{second['id']}/activate").status_code == 200
    )
    body = _status(client)
    assert body["active_profile_id"] == second["id"]
    assert probe.calls[-1].api_key == SECRET_B
    assert [item["id"] for item in body["profiles"]] == before_ids
    assert len(body["profiles"]) == 2
    keys = {item["id"]: item["key_configured"] for item in body["profiles"]}
    assert keys[first["id"]] is True and keys[second["id"]] is True
    assert body["config"]["api_key"] == KEY_MASK
    assert body["config"]["base_url"] == "https://b.example.com/v1"


def test_activate_failure_keeps_current_state(client, probe):
    first = _create(client, "A", key=SECRET_A)
    _confirm(client, "https://api.example.com/v1")
    assert (
        client.post(f"/api/settings/embedding/profiles/{first['id']}/activate").status_code == 200
    )
    before = _status(client)
    probe.ok = False
    probe.error = "凭据无效（HTTP 401）"
    second = _create(client, "B", key=SECRET_B)
    failed = client.post(f"/api/settings/embedding/profiles/{second['id']}/activate")
    assert failed.status_code == 400
    assert "401" in failed.json()["detail"]
    after = _status(client)
    assert after["state"] == before["state"] == "ready"
    assert after["last_error"] == ""
    assert after["active_profile_id"] == first["id"]
    assert after["config"]["model"] == before["config"]["model"]


def test_activate_requires_host_confirmation(client, probe):
    profile = _create(client, "未确认", key=SECRET_A, base_url="https://unconfirmed.example.com/v1")
    response = client.post(f"/api/settings/embedding/profiles/{profile['id']}/activate")
    assert response.status_code == 400
    assert "确认" in response.json()["detail"]
    assert _status(client)["active_profile_id"] == ""


def test_delete_active_falls_back_then_disables(client, probe):
    first = _create(client, "A", key=SECRET_A, base_url="https://a.example.com/v1")
    second = _create(client, "B", key=SECRET_B, base_url="https://b.example.com/v1")
    _confirm(client, "https://a.example.com/v1")
    _confirm(client, "https://b.example.com/v1")
    assert (
        client.post(f"/api/settings/embedding/profiles/{first['id']}/activate").status_code == 200
    )
    assert (
        client.post(f"/api/settings/embedding/profiles/{second['id']}/activate").status_code == 200
    )
    body = client.delete(f"/api/settings/embedding/profiles/{second['id']}").json()
    assert body["active_profile_id"] == first["id"]
    assert [item["id"] for item in body["profiles"]] == [first["id"]]
    body = client.delete(f"/api/settings/embedding/profiles/{first['id']}").json()
    assert body["profiles"] == []
    assert body["active_profile_id"] == ""
    assert read_embedding_config() is None


def test_delete_non_active_profile_keeps_current_state(client, probe):
    first = _create(client, "A", key=SECRET_A)
    _create(client, "B", key=SECRET_B)
    _confirm(client, "https://api.example.com/v1")
    assert (
        client.post(f"/api/settings/embedding/profiles/{first['id']}/activate").status_code == 200
    )
    body = _status(client)
    spare = next(item for item in body["profiles"] if item["id"] != first["id"])
    deleted = client.delete(f"/api/settings/embedding/profiles/{spare['id']}")
    assert deleted.status_code == 200
    after = _status(client)
    assert after["state"] == "ready"
    assert after["active_profile_id"] == first["id"]


def test_profile_test_borrows_only_its_own_stored_key(client, probe):
    profile = _create(client, "A", key=SECRET_A)
    url = f"/api/settings/embedding/profiles/{profile['id']}/test"
    assert client.post(url, json={}).status_code == 200
    assert probe.calls[-1].api_key == SECRET_A
    # 草稿空 key = 沿用这一条自己的 key
    assert (
        client.post(url, json={"config": {"model": "draft-model", "api_key": ""}}).status_code
        == 200
    )
    assert probe.calls[-1].api_key == SECRET_A
    assert probe.calls[-1].model == "draft-model"
    # 显式清除哨兵 → 这次探测不带密钥
    assert (
        client.post(
            url, json={"config": {"model": "draft-model", "api_key": "__clear__"}}
        ).status_code
        == 200
    )
    assert probe.calls[-1].api_key == ""


def test_clear_key_endpoint_keeps_profile(client, probe):
    profile = _create(client, "A", key=SECRET_A)
    _confirm(client, "https://api.example.com/v1")
    assert (
        client.post(f"/api/settings/embedding/profiles/{profile['id']}/activate").status_code == 200
    )
    body = client.post(f"/api/settings/embedding/profiles/{profile['id']}/clear-key").json()
    assert body["profiles"][0]["key_configured"] is False
    assert body["state"] == "disabled"
    assert body["profiles"][0]["id"] == profile["id"]


def test_legacy_remote_enable_creates_default_profile(client, monkeypatch):
    class FakeRemote:
        async def probe_remote(self, config):  # noqa: ANN001, ANN202
            del config
            return SimpleNamespace(ok=True, dim=16, elapsed_ms=2, model="mock-embed", error="")

        async def fetch_models(self, config):  # noqa: ANN001, ANN202
            del config
            return []

    monkeypatch.setattr(settings_embedding, "_remote_api", lambda: FakeRemote())
    _confirm(client, "https://api.example.com/v1")
    response = client.post(
        "/api/settings/embedding/remote/enable",
        json={
            "provider": "openai-http",
            "base_url": "https://api.example.com/v1",
            "model": "mock-embed",
            "api_key": SECRET_A,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "ready"
    assert [item["name"] for item in body["profiles"]] == ["默认配置"]
    assert body["active_profile_id"] == body["profiles"][0]["id"]


def test_remote_test_borrows_key_from_given_profile(client, monkeypatch):
    profile = _create(client, "A", key=SECRET_A)
    calls: list = []

    class FakeRemote:
        async def probe_remote(self, config):  # noqa: ANN001, ANN202
            calls.append(config)
            return SimpleNamespace(ok=True, dim=16, elapsed_ms=2, model=config.model, error="")

        async def fetch_models(self, config):  # noqa: ANN001, ANN202
            del config
            return []

    monkeypatch.setattr(settings_embedding, "_remote_api", lambda: FakeRemote())
    response = client.post(
        "/api/settings/embedding/remote/test",
        json={
            "provider": "openai-http",
            "base_url": "https://api.example.com/v1",
            "model": "mock-embed",
            "api_key": "",
            "profile_id": profile["id"],
        },
    )
    assert response.status_code == 200
    assert calls[-1].api_key == SECRET_A


def test_profiles_are_not_stored_in_database_only_file(client):
    _create(client, "A", key=SECRET_A)
    raw = json.loads(global_settings.path().read_text(encoding="utf-8"))
    assert raw["version"] == 2
    assert PROFILES_KEY in raw
    assert raw[PROFILES_KEY]["profiles"][0]["name"] == "A"


__all__: list[str] = []
