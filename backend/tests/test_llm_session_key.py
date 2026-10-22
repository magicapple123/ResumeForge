# SPDX-License-Identifier: Apache-2.0
"""「仅本会话使用」的临时密钥通道（RF-24）与 DPAPI 失败语义。

从 test_api_settings.py 拆出：该文件超 500 行预算（test_file_size_budget 守门），
而这批用例自成一体——会话密钥的 API 往返、零落库、占位符兜底、DPAPI 失败显式报错。
"""

import pytest
from app.schemas.setting import LLMConfig
from app.services.api_key_crypto import ApiKeyEncryptionError
from app.services.api_key_session import clear_session_key
from app.services.settings_service import API_KEY_MASK, get_llm_config


@pytest.fixture(autouse=True)
def _clean_session_key():
    """会话密钥是模块级内存态，测试间必须清场，否则覆盖 get_llm_config 会污染别的用例。"""
    clear_session_key()
    yield
    clear_session_key()


def test_session_key_roundtrip_via_api(client):
    assert client.get("/api/settings/llm/session-key").json() == {"configured": False}

    set_response = client.put("/api/settings/llm/session-key", json={"api_key": "sk-session-only"})
    assert set_response.status_code == 200
    assert set_response.json() == {"configured": True}
    # 密钥本体永不回传。
    assert "sk-session-only" not in set_response.text
    assert client.get("/api/settings/llm/session-key").json() == {"configured": True}

    assert client.delete("/api/settings/llm/session-key").status_code == 204
    assert client.get("/api/settings/llm/session-key").json() == {"configured": False}


def test_session_key_rejects_empty_value(client):
    assert client.put("/api/settings/llm/session-key", json={"api_key": ""}).status_code == 422


def test_session_key_is_used_for_llm_config_and_never_persisted(client, db_session):
    config = LLMConfig(base_url="https://api.example.com/v1", model="test-model")
    saved = client.put("/api/settings/llm", json=config.model_dump()).json()

    # 记录临时密钥（模拟"仅会话使用"的保存动作：密钥进内存通道）。
    assert (
        client.put("/api/settings/llm/session-key", json={"api_key": "sk-session-only"}).status_code
        == 200
    )
    # 常规保存请求只落 Base URL/模型等，api_key 显式为空。
    client.put("/api/settings/llm", json={**saved, "api_key": ""})

    # 读取时临时密钥生效（脱敏返回），生成链路用的 get_llm_config 拿得到它。
    masked = client.get("/api/settings/llm").json()
    assert masked["api_key"] == API_KEY_MASK
    assert get_llm_config(db_session).api_key == "sk-session-only"

    # 但它绝不落库：库里存的是空串，重启即失。
    db_session.expire_all()
    import json as _json

    from app.models.setting import AppSetting

    raw = _json.loads(db_session.get(AppSetting, "llm_config").value)
    assert raw["api_key"] == ""


def test_session_key_placeholder_roundtrip_does_not_persist_it(client, db_session):
    """占位符解析到临时密钥时，落库为空而不是把内存态写进数据库。"""
    client.put("/api/settings/llm/session-key", json={"api_key": "sk-session-only"})
    masked = client.get("/api/settings/llm").json()
    assert masked["api_key"] == API_KEY_MASK

    # 前端原样回传占位符（如改个模型名再保存）。
    client.put("/api/settings/llm", json=masked)

    db_session.expire_all()
    import json as _json

    from app.models.setting import AppSetting

    raw = _json.loads(db_session.get(AppSetting, "llm_config").value)
    assert raw["api_key"] == ""


def test_dpapi_failure_fails_loudly_and_never_persists_key(client, db_session, monkeypatch):
    """DPAPI 加密失败：API 显式报错，密钥不落盘、不伪装成功（RF-24）。"""
    from app.models.setting import AppSetting

    def broken_encrypt(_plaintext):
        raise ApiKeyEncryptionError("本机密钥保护服务（Windows DPAPI）加密失败")

    monkeypatch.setattr("app.services.llm_settings.encrypt_key", broken_encrypt)
    # 全局记录走 global_settings 的加密入口（同一套 DPAPI，只是另一个绑定）；
    # 两个落点都要在失败时明确报错，而不是"数据集没写、全局却写进去了"。
    monkeypatch.setattr("app.services.global_settings.encrypt_key", broken_encrypt)
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="sk-test", model="m")

    response = client.put("/api/settings/llm", json=config.model_dump())

    assert response.status_code == 503
    assert "加密失败" in response.json()["detail"]
    assert "sk-test" not in response.text
    db_session.expire_all()
    assert db_session.get(AppSetting, "llm_config") is None

    # 配置记录同语义。
    record_response = client.post(
        "/api/settings/llm/records", json={"name": "记录", **config.model_dump()}
    )
    assert record_response.status_code == 503
    assert db_session.query(AppSetting).count() == 0
