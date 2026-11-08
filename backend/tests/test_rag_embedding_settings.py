# SPDX-License-Identifier: Apache-2.0
"""RAG v3 provider 持久化（embedding_settings）单测：掩码、切换、确认、隔离。"""

from __future__ import annotations

import json

import pytest
from app.config import Settings
from app.services import global_settings
from app.services.llm.embedding_settings import (
    EMBEDDING_PROVIDERS,
    KEY_MASK,
    EmbeddingProviderConfig,
    clear_embedding_config,
    config_to_spec,
    configured_hosts,
    endpoint_host,
    is_host_confirmed,
    mark_host_confirmed,
    mask_embedding_config,
    read_embedding_config,
    replace_config,
    revoke_host_confirmed,
    write_embedding_config,
)
from app.services.llm.embeddings import (
    EmbeddingError,
    create_embedding_provider,
    resolve_embedding_spec,
)

SECRET = "unit-test-key-value-not-a-real-credential"


@pytest.fixture(autouse=True)
def _clean_global_settings():
    path = global_settings.path()
    path.unlink(missing_ok=True)
    yield
    path.unlink(missing_ok=True)


def _remote_config(**overrides) -> EmbeddingProviderConfig:
    base = EmbeddingProviderConfig(
        provider="openai-http",
        enabled=True,
        model="mock-embed",
        dim=16,
        pooling="server",
        base_url="https://api.example.com/v1",
        api_key=SECRET,
    )
    return replace_config(base, **overrides)


def test_write_read_mask_and_secret_never_plaintext_on_disk():
    stored = write_embedding_config(_remote_config())
    assert stored.provider == "openai-http" and stored.dim == 16

    revealed = read_embedding_config(reveal_key=True)
    assert revealed is not None and revealed.api_key == SECRET
    masked_read = read_embedding_config()
    assert masked_read is not None and masked_read.api_key == KEY_MASK
    assert mask_embedding_config(revealed)["api_key"] == KEY_MASK

    raw = global_settings.path().read_text(encoding="utf-8")
    assert SECRET not in raw, "明文密钥绝不能出现在 global_settings.json 里"


def test_write_with_mask_keeps_existing_secret():
    write_embedding_config(_remote_config())
    write_embedding_config(_remote_config(api_key=KEY_MASK, model="mock-embed-2"))
    revealed = read_embedding_config(reveal_key=True)
    assert revealed is not None
    assert revealed.api_key == SECRET
    assert revealed.model == "mock-embed-2"


def test_clear_keeps_llm_and_theme_state():
    global_settings.mutate_state(lambda state: state.update({"theme": "dark"}))
    write_embedding_config(_remote_config())
    assert read_embedding_config() is not None

    clear_embedding_config()
    assert read_embedding_config() is None
    raw = json.loads(global_settings.path().read_text(encoding="utf-8"))
    assert raw.get("theme") == "dark"
    assert "llm" in raw and "embedding" not in raw


def test_invalid_provider_rejected():
    with pytest.raises(ValueError):
        write_embedding_config(EmbeddingProviderConfig(provider="some-vendor"))
    assert set(EMBEDDING_PROVIDERS) == {"fake", "local-onnx", "openai-http"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://api.example.com/v1", "api.example.com"),
        ("http://user:pass@Host.Example.com:8080/v1", "host.example.com"),
        ("http://127.0.0.1:11434/v1", "127.0.0.1"),
        ("localhost:11434", "localhost"),
        ("", ""),
        ("http://[::1]:8080/v1", "::1"),
    ],
)
def test_endpoint_host_extraction(raw, expected):
    assert endpoint_host(raw) == expected


def test_host_confirmation_roundtrip_and_config_flag():
    hosts = mark_host_confirmed("https://API.Example.com/v1")
    assert hosts == ["api.example.com"]
    assert configured_hosts() == ["api.example.com"]
    # 只有确认记录、没有完整配置时也要能读出已确认列表
    pending = replace_config(
        EmbeddingProviderConfig(),
        provider="openai-http",
        base_url="https://api.example.com/v1",
        confirmed_hosts=tuple(configured_hosts()),
    )
    assert is_host_confirmed(pending) is True

    write_embedding_config(_remote_config(confirmed_hosts=tuple(configured_hosts())))
    stored = read_embedding_config(reveal_key=True)
    assert stored is not None and is_host_confirmed(stored)
    revoke_host_confirmed("api.example.com")
    stored = read_embedding_config(reveal_key=True)
    assert stored is not None and not is_host_confirmed(stored)


def test_corrupt_section_degrades_to_none():
    global_settings.mutate_state(lambda state: state.update({"embedding": {"provider": "weird"}}))
    assert read_embedding_config() is None


def test_resolve_spec_prefers_enabled_persisted_config():
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
    spec = resolve_embedding_spec(Settings(rag_embedding_provider="fake"))
    assert spec is not None
    assert spec.provider == "local-onnx" and spec.dim == 384 and spec.model.startswith("granite")

    write_embedding_config(replace_config(read_embedding_config(reveal_key=True), enabled=False))
    fallback = resolve_embedding_spec(Settings(rag_embedding_provider="fake"))
    assert fallback is not None and fallback.provider == "fake"


def test_fake_provider_still_guarded_by_env_switch():
    spec = resolve_embedding_spec(Settings(rag_embedding_provider="fake"))
    provider = create_embedding_provider(spec)
    assert provider is not None
    # fake 是否允许参与排序由 rag_service 的 allow_fake 守卫决定，工厂照常返回实例。


def test_local_provider_without_runtime_reports_readable_error():
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
    spec = config_to_spec(read_embedding_config(reveal_key=True))
    with pytest.raises(EmbeddingError) as excinfo:
        create_embedding_provider(spec)
    assert "本地语义检索" in str(excinfo.value)


def test_remote_provider_requires_confirmed_host():
    write_embedding_config(_remote_config())
    spec = config_to_spec(read_embedding_config(reveal_key=True))
    with pytest.raises(EmbeddingError) as excinfo:
        create_embedding_provider(spec)
    assert "确认" in str(excinfo.value)


def test_remote_payload_carries_no_full_url_credentials():
    write_embedding_config(_remote_config(base_url="https://user:pass@api.example.com/v1"))
    config = read_embedding_config(reveal_key=True)
    assert config is not None
    # 写盘时就已去掉 userinfo：URL 里的用户名/密码既不是 api_key，也不该被保存/回显。
    assert config.base_url == "https://api.example.com/v1"
    payload = mask_embedding_config(config)
    assert payload["host"] == "api.example.com"
    assert "user:pass" not in json.dumps(payload, ensure_ascii=False)


def test_default_settings_for_v3():
    settings = Settings()
    assert settings.rag_embedding_allow_private_endpoint is False
    assert settings.rag_request_budget_seconds == 1.5
    assert "releases" in settings.rag_asset_base_url
    assert settings.rag_local_model_dirname == "rag-model"
    assert settings.rag_local_runtime_dirname == "rag-runtime"
