# SPDX-License-Identifier: Apache-2.0
"""
语义检索命名配置的服务层（清单第 1/16 条）：迁移、CRUD、激活、密钥隔离。

覆盖清单 §1.8 的服务层用例：旧配置迁移、名称唯一/上限、空 key 只沿用同一条 profile、
删除回落、激活失败不污染、本地↔远程互切不丢数据、clear-key 只清目标条。
网络探测一律 stub（本机只有一份真实凭据，见交付说明）。
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from app.services import global_settings
from app.services.llm import embedding_activation, embedding_profiles, embedding_profiles_store
from app.services.llm.embedding_profiles import (
    ProfileActivationError,
    ProfileConflictError,
    ProfileError,
)
from app.services.llm.embedding_settings import (
    EmbeddingProviderConfig,
    configured_hosts,
    encrypt_secret,
    mark_host_confirmed,
    read_embedding_config,
    revoke_host_confirmed,
)
from tests.api_key_at_rest import assert_key_at_rest

SECRET_A = "key-profile-a"
SECRET_B = "key-profile-b"


def _write_state(extra: dict | None = None) -> None:
    payload: dict = {
        "version": 2,
        "llm": {"enabled": False, "active_profile_id": "", "profiles": []},
    }
    payload.update(extra or {})
    global_settings.path().write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _legacy_remote(**overrides) -> dict:
    section = {
        "version": 1,
        "provider": "openai-http",
        "enabled": True,
        "model": "mock-embed",
        "dim": 16,
        "pooling": "server",
        "normalize": True,
        "base_url": "https://api.example.com/v1",
        "api_key": encrypt_secret(SECRET_A),
        "batch_size": 25,
        "endpoint_mode": "openai",
        "request_url": "",
        "headers": [],
        "body_template": "",
        "response_path": "data[*].embedding",
        "allow_private": False,
        "confirmed_hosts": ["api.example.com"],
        "updated_at": "2026-11-09T10:00:00+00:00",
    }
    section.update(overrides)
    return section


def _legacy_local() -> dict:
    return {
        "version": 1,
        "provider": "local-onnx",
        "enabled": True,
        "model": "granite-embedding-97m-multilingual-r2",
        "dim": 384,
        "pooling": "cls",
        "normalize": True,
        "variant": "int8_avx2",
        "confirmed_hosts": ["api.example.com"],
        "updated_at": "2026-11-09T10:00:00+00:00",
    }


@pytest.fixture
def probe_calls(monkeypatch):
    calls: list = []

    async def fake_probe(config):  # noqa: ANN001, ANN202
        calls.append(config)
        return SimpleNamespace(ok=True, dim=16, elapsed_ms=3, model=config.model, error="")

    monkeypatch.setattr(embedding_activation, "_probe", fake_probe)
    return calls


@pytest.fixture
def local_ready(monkeypatch):
    local_config = EmbeddingProviderConfig(
        provider="local-onnx",
        enabled=True,
        model="granite-embedding-97m-multilingual-r2",
        dim=384,
        pooling="cls",
        variant="int8_avx2",
    )
    monkeypatch.setattr(embedding_activation, "_local_state", lambda: "ready")
    monkeypatch.setattr(embedding_profiles_store, "_local_config_from_assets", lambda: local_config)
    monkeypatch.setattr(embedding_activation, "_local_config_from_assets", lambda: local_config)
    return local_config


def _save(
    name: str,
    *,
    key: str = "",
    model: str = "mock-embed",
    base_url: str = "https://api.example.com/v1",
):
    mark_host_confirmed(base_url)
    return embedding_profiles_store.save_profile(
        name=name,
        config={"base_url": base_url, "model": model, "api_key": key},
    )


def _active_id() -> str:
    return str(embedding_profiles.active_meta()["active_profile_id"])


# --- 迁移 ---


def test_migrate_legacy_remote_to_default_profile():
    _write_state({"embedding": _legacy_remote()})
    embedding_profiles_store.migrate_legacy_once()
    profiles = embedding_profiles.list_profiles()
    assert len(profiles) == 1
    profile = profiles[0]
    assert profile["name"] == "默认配置"
    assert profile["key_configured"] is True
    assert profile["host"] == "api.example.com"
    assert _active_id() == profile["id"]
    config = read_embedding_config(reveal_key=True)
    assert config is not None
    assert config.api_key == SECRET_A
    assert config.enabled is True
    # 幂等：再调一次不能复活/复制
    embedding_profiles_store.migrate_legacy_once()
    assert len(embedding_profiles.list_profiles()) == 1
    # 版本号不能提升（升了 load_state 会连主题与大模型配置一起读丢）
    assert json.loads(global_settings.path().read_text(encoding="utf-8"))["version"] == 2


def test_migrate_legacy_local_does_not_create_remote_profile():
    _write_state({"embedding": _legacy_local()})
    embedding_profiles_store.migrate_legacy_once()
    assert embedding_profiles.list_profiles() == []
    assert embedding_profiles.active_meta()["local_profile_id"]
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.provider == "local-onnx"
    # 旧本地配置也没有远程 key
    assert config.api_key == ""


def test_migrated_status_keeps_confirmed_hosts():
    _write_state({"embedding": _legacy_remote()})
    embedding_profiles_store.migrate_legacy_once()
    assert configured_hosts() == ["api.example.com"]


# --- CRUD 与名称规则 ---


def test_read_falls_back_to_legacy_section_without_profiles():
    """没有 profiles 时 read_embedding_config 必须回退旧扁平段（运行时/RAG 的唯一入口）。"""
    _write_state({"embedding": _legacy_remote()})
    config = read_embedding_config(reveal_key=True)
    assert config is not None
    assert config.model == "mock-embed"
    assert config.api_key == SECRET_A
    assert config.enabled is True


def test_profiles_take_precedence_over_stale_mirror():
    """反证：旧版只改 embedding 镜像时，新版读取必须仍以 profiles 为准。"""
    _write_state({"embedding": _legacy_remote()})
    embedding_profiles_store.migrate_legacy_once()
    migrated = embedding_profiles.list_profiles()[0]
    embedding_profiles_store.save_profile(
        profile_id=migrated["id"],
        name=migrated["name"],
        config={
            "base_url": "https://api.example.com/v1",
            "model": "profile-model",
            "api_key": "",
        },
    )
    state = json.loads(global_settings.path().read_text(encoding="utf-8"))
    state["embedding"]["model"] = "stale-mirror-model"
    state["embedding"]["base_url"] = "https://stale.example.com/v1"
    global_settings.path().write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    config = read_embedding_config(reveal_key=True)
    assert config is not None
    assert config.model == "profile-model"
    assert config.base_url == "https://api.example.com/v1"
    assert config.api_key == SECRET_A


def test_save_profile_masks_key_and_encrypts_at_rest():
    profile = _save("公司 Azure", key=SECRET_A)
    # 跨平台恒真：回包只有掩码 / 布尔，读回能拿到明文。
    assert profile["key_configured"] is True
    assert "api_key" not in profile
    assert "api_key" not in json.dumps(profile)
    assert profile["host"] == "api.example.com"
    raw_text = global_settings.path().read_text(encoding="utf-8")
    stored = json.loads(raw_text)["embedding_profiles"]["profiles"][0]["config"]["api_key"]
    # 落盘形态随平台：Windows = DPAPI 密文，其它平台按设计就是明文（见 tests/api_key_at_rest）。
    assert_key_at_rest(stored, secret=SECRET_A, raw=raw_text)
    assert embedding_profiles.profile_key(profile["id"]) == SECRET_A


def test_duplicate_name_is_conflict():
    _save("同名")
    with pytest.raises(ProfileConflictError):
        _save("同名")


def test_name_rules_and_limit():
    with pytest.raises(ProfileError):
        _save("   ")
    with pytest.raises(ProfileError):
        _save("长" * 65)
    for index in range(20):
        _save(f"配置 {index}")
    with pytest.raises(ProfileError):
        _save("第 21 条")


def test_rename_keeps_same_profile_id():
    profile = _save("旧名", key=SECRET_A)
    renamed = embedding_profiles_store.save_profile(
        profile_id=profile["id"],
        name="新名",
        config={"base_url": "https://api.example.com/v1", "model": "mock-embed", "api_key": ""},
    )
    assert renamed["id"] == profile["id"]
    assert renamed["name"] == "新名"
    # 编辑时空 key 沿用同一条自己的旧 key
    assert embedding_profiles.profile_key(profile["id"]) == SECRET_A


def test_empty_key_is_never_inherited_from_another_profile():
    _save("A", key=SECRET_A)
    b = embedding_profiles_store.save_profile(
        name="B",
        config={"base_url": "https://api.example.com/v1", "model": "mock-embed", "api_key": ""},
    )
    # B 新建时 key 为空 = 没有密钥，绝不能借 A 的
    assert embedding_profiles.profile_key(b["id"]) == ""


def test_explicit_clear_sentinel():
    profile = _save("A", key=SECRET_A)
    embedding_profiles_store.save_profile(
        profile_id=profile["id"],
        name="A",
        config={
            "base_url": "https://api.example.com/v1",
            "model": "mock-embed",
            "api_key": "__clear__",
        },
    )
    assert embedding_profiles.profile_key(profile["id"]) == ""


# --- 激活 ---


@pytest.mark.asyncio
async def test_activate_without_key_is_rejected(probe_calls):
    profile = embedding_profiles_store.save_profile(
        name="无密钥",
        config={"base_url": "https://api.example.com/v1", "model": "m", "api_key": ""},
    )
    with pytest.raises(ProfileActivationError) as excinfo:
        await embedding_activation.activate_profile(profile["id"])
    assert "密钥" in str(excinfo.value)
    assert _active_id() == ""


@pytest.mark.asyncio
async def test_activate_requires_confirmed_host(probe_calls):
    mark_host_confirmed("https://api.example.com/v1")
    other = embedding_profiles_store.save_profile(
        name="未确认",
        config={"base_url": "https://other.example.com/v1", "model": "m", "api_key": SECRET_B},
    )
    with pytest.raises(ProfileActivationError) as excinfo:
        await embedding_activation.activate_profile(other["id"])
    assert "确认" in str(excinfo.value)
    mark_host_confirmed("https://other.example.com/v1")
    await embedding_activation.activate_profile(other["id"])
    assert _active_id() == other["id"]


@pytest.mark.asyncio
async def test_activation_failure_keeps_current_active(probe_calls, monkeypatch):
    first = _save("A", key=SECRET_A)
    await embedding_activation.activate_profile(first["id"])
    before = read_embedding_config(reveal_key=True)

    async def failing_probe(config):  # noqa: ANN001, ANN202
        return SimpleNamespace(ok=False, dim=0, elapsed_ms=1, model=config.model, error="HTTP 401")

    monkeypatch.setattr(embedding_activation, "_probe", failing_probe)
    second = _save("B", key=SECRET_B)
    with pytest.raises(ProfileActivationError) as excinfo:
        await embedding_activation.activate_profile(second["id"])
    assert "401" in str(excinfo.value)
    assert _active_id() == first["id"]
    after = read_embedding_config(reveal_key=True)
    assert after is not None and before is not None
    assert after.model == before.model and after.enabled is True
    assert after.last_error == ""


@pytest.mark.asyncio
async def test_activate_uses_only_that_profiles_key(probe_calls):
    a = _save("A", key=SECRET_A)
    mark_host_confirmed("https://b.example.com/v1")
    b = embedding_profiles_store.save_profile(
        name="B",
        config={"base_url": "https://b.example.com/v1", "model": "m", "api_key": SECRET_B},
    )
    await embedding_activation.activate_profile(b["id"])
    # 发给上游的 API key 必须是 B 自己的那条，而不是 A 的
    assert probe_calls[-1].api_key == SECRET_B
    assert a["id"] != b["id"]


@pytest.mark.asyncio
async def test_delete_active_falls_back_to_first_remaining(probe_calls):
    a = _save("A", key=SECRET_A)
    await embedding_activation.activate_profile(a["id"])
    b = _save("B", key=SECRET_B)
    await embedding_activation.activate_profile(b["id"])
    await embedding_profiles_store.delete_profile(b["id"])
    remaining = embedding_profiles.list_profiles()
    assert [item["id"] for item in remaining] == [a["id"]]
    assert _active_id() == a["id"]
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.enabled is True and config.api_key == SECRET_A


@pytest.mark.asyncio
async def test_delete_non_active_profile_keeps_active(probe_calls):
    for name in ("A", "B", "C"):
        _save(name, key=SECRET_A)
    profiles = {item["name"]: item for item in embedding_profiles.list_profiles()}
    await embedding_activation.activate_profile(profiles["B"]["id"])
    await embedding_profiles_store.delete_profile(profiles["C"]["id"])
    state = embedding_profiles.active_meta()
    assert state["active_profile_id"] == profiles["B"]["id"]
    config = read_embedding_config(reveal_key=True)
    assert config is not None and config.enabled is True
    remaining_names = sorted(item["name"] for item in embedding_profiles.list_profiles())
    assert remaining_names == ["A", "B"]


@pytest.mark.asyncio
async def test_delete_last_profile_clears_mirror(probe_calls):
    only = _save("唯一", key=SECRET_A)
    await embedding_activation.activate_profile(only["id"])
    await embedding_profiles_store.delete_profile(only["id"])
    assert embedding_profiles.list_profiles() == []
    assert _active_id() == ""
    assert read_embedding_config() is None
    assert configured_hosts() == ["api.example.com"]


@pytest.mark.asyncio
async def test_switch_between_local_and_remote_keeps_both(probe_calls, local_ready):
    remote = _save("远程", key=SECRET_A)
    await embedding_activation.activate_profile(remote["id"])
    before = read_embedding_config(reveal_key=True)
    assert before is not None and before.provider == "openai-http"
    embedding_profiles_store.ensure_local_profile({"state": "ready"})
    local_id = embedding_profiles.active_meta()["local_profile_id"]
    assert local_id
    await embedding_activation.activate_profile(local_id)
    local = read_embedding_config(reveal_key=True)
    assert local is not None and local.provider == "local-onnx"
    assert _active_id() == local_id
    # 远程配置仍在、密钥未丢、只是不生效
    profiles = {item["id"]: item for item in embedding_profiles.list_profiles()}
    assert remote["id"] in profiles
    assert profiles[remote["id"]]["key_configured"] is True
    await embedding_activation.activate_profile(remote["id"])
    back = read_embedding_config(reveal_key=True)
    assert back is not None and back.provider == "openai-http"
    assert back.api_key == SECRET_A
    assert back.base_url == before.base_url and back.model == before.model
    # 本地 profile 也没被删
    assert embedding_profiles.active_meta()["local_profile_id"] == local_id


# --- 清密钥 / 撤销 host ---


@pytest.mark.asyncio
async def test_clear_key_only_affects_target(probe_calls):
    a = _save("A", key=SECRET_A)
    b = _save("B", key=SECRET_B)
    await embedding_activation.activate_profile(a["id"])
    embedding_profiles_store.clear_profile_key(a["id"])
    assert embedding_profiles.profile_key(a["id"]) == ""
    assert embedding_profiles.profile_key(b["id"]) == SECRET_B
    config = read_embedding_config(reveal_key=True)
    # 生效项被清密钥 → 一并停用，但配置本身保留
    assert config is not None and config.enabled is False
    assert [item["id"] for item in embedding_profiles.list_profiles()] == [a["id"], b["id"]]


@pytest.mark.asyncio
async def test_revoke_host_disables_only_matching_active(probe_calls):
    a = _save("A", key=SECRET_A)
    await embedding_activation.activate_profile(a["id"])
    revoke_host_confirmed("api.example.com")
    from app.services.llm.embedding_settings import replace_config, write_active_embedding_config

    config = read_embedding_config()
    assert config is not None and config.host() == "api.example.com"
    write_active_embedding_config(replace_config(config, enabled=False))
    disabled = read_embedding_config(reveal_key=True)
    assert disabled is not None and disabled.enabled is False
    # 配置本身还在，密钥也没丢
    assert embedding_profiles.list_profiles()[0]["id"] == a["id"]
    assert embedding_profiles.profile_key(a["id"]) == SECRET_A


def _dump() -> str:
    return global_settings.path().read_text(encoding="utf-8")


def test_global_settings_version_stays_two_after_save():
    _save("A", key=SECRET_A)
    assert json.loads(_dump())["version"] == 2
