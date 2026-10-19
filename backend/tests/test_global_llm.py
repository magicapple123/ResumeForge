"""全局模型配置（R21）：一份配置，所有数据集共用。

为什么值得单独一批测试：这条链路决定"实际调用哪个模型"。写坏了不会崩，只会让用户在
B 数据集里悄悄用上 A 数据集的模型/额度——最难发现的一类问题。

四条性质：
1. 显式开启 + base_url/model 齐全 → 全局接管；
2. 没开、只填一半、文件坏 → 一律回落到本数据集配置（升级后行为不变）；
3. API Key 落盘是密文，接口只回"配置过没有"，不清空时保留原密钥；
4. 文件在数据目录根上，与数据集无关（换数据集仍读得到）。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import LLMConfig
from app.services import global_settings
from app.services.settings_service import get_dataset_llm_config, get_llm_config


@pytest.fixture(autouse=True)
def global_dir(tmp_path, monkeypatch):
    """全局配置写到用例自己的目录，别碰开发机的 data/。"""
    monkeypatch.setattr(global_settings, "DATA_DIR", str(tmp_path))
    assert global_settings._path().parent == tmp_path
    return tmp_path


def _dataset_config(client) -> LLMConfig:
    response = client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://dataset.example/v1",
            "model": "dataset-model",
            "api_key": "sk-dataset",
        },
    )
    assert response.status_code == 200, response.text
    return LLMConfig.model_validate(response.json())


def test_enabled_global_config_wins_over_dataset_config(client, db_session):
    _dataset_config(client)
    global_settings.write_global_llm(
        LLMConfig(base_url="https://global.example/v1", model="global-model", api_key="sk-global")
    )

    effective = get_llm_config(db_session)
    assert effective.base_url == "https://global.example/v1"
    assert effective.model == "global-model"
    # 数据集自己的那份没被动过。
    assert get_dataset_llm_config(db_session).model == "dataset-model"


def test_disabled_global_config_falls_back_to_dataset(client, db_session):
    _dataset_config(client)
    global_settings.write_global_llm(
        LLMConfig(base_url="https://global.example/v1", model="global-model"), enabled=False
    )

    assert get_llm_config(db_session).model == "dataset-model"


def test_incomplete_global_config_is_ignored(client, db_session):
    _dataset_config(client)
    # 只有地址没有模型：让这样的配置接管，等于把用户的调用全打到 404 上。
    global_settings.write_global_llm(LLMConfig(base_url="https://global.example/v1", model=""))

    assert get_llm_config(db_session).model == "dataset-model"


def test_corrupt_file_is_ignored_not_fatal(client, db_session):
    _dataset_config(client)
    global_settings._path().write_text("{不是 JSON", encoding="utf-8")

    assert get_llm_config(db_session).model == "dataset-model"
    assert global_settings.read_global_llm() is None


def test_api_roundtrip_masks_key_and_keeps_it_when_blank(client):
    saved = client.put(
        "/api/settings/global-llm",
        json={
            "enabled": True,
            "config": {"base_url": "https://global.example/v1", "model": "global-model"},
            "api_key": "sk-global",
        },
    )
    assert saved.status_code == 200, saved.text
    summary = saved.json()
    assert summary["enabled"] is True
    assert summary["configured"] is True
    assert "api_key" not in summary, "摘要接口绝不能回传密钥"

    # 文件里是密文：明文密钥不出现在磁盘上。
    raw = global_settings._path().read_text(encoding="utf-8")
    assert "sk-global" not in raw

    # 不传 api_key 时保留原密钥；显式 __clear__ 才清空。
    client.put(
        "/api/settings/global-llm",
        json={"enabled": True, "config": {"base_url": "https://global.example/v1", "model": "m2"}},
    )
    assert global_settings.read_global_llm().config.api_key == "sk-global"

    client.put(
        "/api/settings/global-llm",
        json={
            "enabled": True,
            "config": {"base_url": "https://global.example/v1", "model": "m2"},
            "api_key": "__clear__",
        },
    )
    assert global_settings.read_global_llm().config.api_key == ""


def test_delete_restores_dataset_behaviour(client, db_session):
    _dataset_config(client)
    global_settings.write_global_llm(
        LLMConfig(base_url="https://global.example/v1", model="global-model")
    )
    assert get_llm_config(db_session).model == "global-model"

    assert client.delete("/api/settings/global-llm").status_code == 204

    assert get_llm_config(db_session).model == "dataset-model"
    assert not global_settings._path().exists()
