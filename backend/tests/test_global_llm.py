"""全局模型配置（R21）：一份配置，所有数据集共用。

为什么值得单独一批测试：这条链路决定"实际调用哪个模型"。写坏了不会崩，只会让用户在
B 数据集里悄悄用上 A 数据集的模型/额度——最难发现的一类问题。

四条性质：
1. 显式开启 + base_url/model 齐全 → 全局接管；
2. 没开、只填一半、文件坏 → 一律回落到本数据集配置（升级后行为不变）；
3. API Key 落盘：Windows 是 DPAPI 密文，其它平台按设计保持明文（见 api_key_crypto）；
   接口只回"配置过没有"，不清空时保留原密钥；
4. 文件在数据目录根上，与数据集无关（换数据集仍读得到）。
"""

from __future__ import annotations

import sys

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

    # 落盘形态随平台：Windows 只有 DPAPI 密文，其它平台（无 DPAPI）按设计就是明文。
    # 这条断言原本写死"文件里搜不到明文"，于是只在本机（Windows）绿、Ubuntu 上红——
    # 加密是 **Windows 的** 能力，不是跨平台承诺，别把它当成产品的安全边界来测。
    raw = global_settings._path().read_text(encoding="utf-8")
    if sys.platform == "win32":
        assert "sk-global" not in raw
    else:
        assert "sk-global" in raw, "非 Windows 平台按设计保持明文，改了就同步 CHANGELOG"

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


# ---------------------------------------------------------------------------
# schema v2：profiles
# ---------------------------------------------------------------------------


def _v1_payload():
    return {
        "version": 1,
        "llm": {
            "enabled": True,
            "config": {
                "provider": "custom",
                "base_url": "https://legacy.example/v1",
                "model": "legacy-model",
                "api_key": "sk-legacy",
            },
        },
    }


def test_v1_file_is_migrated_to_a_single_profile_on_read():
    """升级后第一次读取：v1 的单配置自动变成一个 profile，并写回 v2。"""
    import json

    path = global_settings._path()
    path.write_text(json.dumps(_v1_payload()), encoding="utf-8")

    loaded = global_settings.read_global_llm()
    assert loaded is not None
    assert loaded.config.model == "legacy-model"
    assert loaded.config.api_key == "sk-legacy"
    assert loaded.name == "默认配置"

    migrated = json.loads(path.read_text(encoding="utf-8"))
    assert migrated["version"] == global_settings.GLOBAL_SETTINGS_VERSION
    assert migrated["llm"]["enabled"] is True
    assert migrated["llm"]["active_profile_id"] == loaded.profile_id
    profiles = migrated["llm"]["profiles"]
    assert len(profiles) == 1
    assert profiles[0]["is_default"] is True
    assert profiles[0]["id"] == loaded.profile_id


def test_v1_write_back_failure_still_reads(monkeypatch):
    """迁移写回失败只记 warning：不能因此让用户升级后配置消失。"""
    import json

    path = global_settings._path()
    path.write_text(json.dumps(_v1_payload()), encoding="utf-8")

    def _boom(_state):
        raise OSError("disk full")

    monkeypatch.setattr(global_settings, "_write_state_unlocked", _boom)

    loaded = global_settings.read_global_llm()
    assert loaded is not None
    assert loaded.config.model == "legacy-model"


def test_profile_crud_and_active_switch(client):
    first = client.post(
        "/api/settings/global-llm/profiles",
        json={
            "name": "DeepSeek 日常",
            "config": {"base_url": "https://a.example/v1", "model": "a-model"},
            "api_key": "sk-a",
            "models": ["a-model"],
        },
    )
    assert first.status_code == 200, first.text
    summary = first.json()
    assert len(summary["profiles"]) == 1
    first_id = summary["profiles"][0]["id"]
    assert summary["active_profile_id"] == first_id
    assert summary["active_name"] == "DeepSeek 日常"
    # 摘要里任何一层都不能出现密钥（含 profile 子项）。
    assert "api_key" not in first.text
    assert "sk-a" not in first.text

    second = client.post(
        "/api/settings/global-llm/profiles",
        json={
            "name": "备用",
            "config": {"base_url": "https://b.example/v1", "model": "b-model"},
            "api_key": "sk-b",
        },
    ).json()
    assert len(second["profiles"]) == 2
    second_id = next(p["id"] for p in second["profiles"] if p["name"] == "备用")

    # 切换：active 变化，且实际读到的配置跟着变。
    activated = client.post("/api/settings/global-llm/activate", json={"id": second_id})
    assert activated.status_code == 200, activated.text
    assert activated.json()["active_profile_id"] == second_id
    assert activated.json()["enabled"] is True
    assert global_settings.read_global_llm().config.model == "b-model"

    # 编辑：留空 api_key 保留原密钥。
    edited = client.put(
        f"/api/settings/global-llm/profiles/{second_id}",
        json={
            "name": "备用（改名）",
            "config": {"base_url": "https://b.example/v1", "model": "b-model-2"},
        },
    )
    assert edited.status_code == 200, edited.text
    saved = global_settings.read_global_llm()
    assert saved.config.model == "b-model-2"
    assert saved.config.api_key == "sk-b"

    # 显式 __clear__ 才清空。
    client.put(
        f"/api/settings/global-llm/profiles/{second_id}",
        json={
            "config": {"base_url": "https://b.example/v1", "model": "b-model-2"},
            "api_key": "__clear__",
        },
    )
    assert global_settings.read_global_llm().config.api_key == ""

    # 删除当前 active：自动切到剩下的第一个。
    deleted = client.delete(f"/api/settings/global-llm/profiles/{second_id}")
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert [p["id"] for p in body["profiles"]] == [first_id]
    assert body["active_profile_id"] == first_id

    # 最后一个也删：回到未配置，不会留下一个空 profile 冒充生效。
    last = client.delete(f"/api/settings/global-llm/profiles/{first_id}").json()
    assert last["profiles"] == []
    assert last["enabled"] is False
    assert last["configured"] is False
    assert global_settings.read_global_llm() is None


def test_put_global_llm_updates_only_the_active_profile(client):
    created = client.post(
        "/api/settings/global-llm/profiles",
        json={
            "name": "甲",
            "config": {"base_url": "https://a.example/v1", "model": "a-model"},
        },
    ).json()
    first_id = created["profiles"][0]["id"]
    client.post(
        "/api/settings/global-llm/profiles",
        json={
            "name": "乙",
            "config": {"base_url": "https://b.example/v1", "model": "b-model"},
        },
    )
    client.post("/api/settings/global-llm/activate", json={"id": first_id})

    saved = client.put(
        "/api/settings/global-llm",
        json={
            "enabled": True,
            "config": {"base_url": "https://a2.example/v1", "model": "a-model-2"},
            "api_key": "sk-a2",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["active_profile_id"] == first_id
    assert global_settings.read_global_llm().config.model == "a-model-2"
    # 另一个 profile 完全没动。
    summary = client.get("/api/settings/global-llm").json()
    other_profile = next(p for p in summary["profiles"] if p["id"] != first_id)
    assert other_profile["model"] == "b-model"


def test_profile_endpoints_reject_unknown_ids_and_bad_fields(client):
    assert (
        client.post("/api/settings/global-llm/activate", json={"id": "p_nope"}).status_code == 404
    )
    assert client.delete("/api/settings/global-llm/profiles/p_nope").status_code == 404
    assert (
        client.put("/api/settings/global-llm/profiles/p_nope", json={"name": "x"}).status_code
        == 404
    )
    # 名称空 → 400；配置字段不合法（温度超范围）→ 400。
    assert (
        client.post(
            "/api/settings/global-llm/profiles",
            json={"name": "   ", "config": {"base_url": "https://a/v1", "model": "m"}},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/settings/global-llm/profiles",
            json={
                "name": "坏配置",
                "config": {"base_url": "https://a/v1", "model": "m", "temperature": 9},
            },
        ).status_code
        == 400
    )


def test_concurrent_writes_keep_the_file_valid():
    """20 个线程同时写：锁 + 随机临时文件，最终必须是合法 JSON 且只有一个 profile。"""
    import json
    from concurrent.futures import ThreadPoolExecutor

    def _write(index: int) -> None:
        global_settings.write_global_llm(
            LLMConfig(
                base_url=f"https://t{index}.example/v1",
                model=f"model-{index}",
                api_key=f"sk-{index}",
            )
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(_write, range(20)))

    data = json.loads(global_settings._path().read_text(encoding="utf-8"))
    assert data["version"] == global_settings.GLOBAL_SETTINGS_VERSION
    assert len(data["llm"]["profiles"]) == 1
    # 最终落盘的是某一次完整写入（不是两次写拼出来的半个 JSON）。
    assert data["llm"]["profiles"][0]["config"]["model"].startswith("model-")


# ---------------------------------------------------------------------------
# 顶层 theme（R18）：与 llm 并列，互不覆盖
# ---------------------------------------------------------------------------


def test_theme_is_absent_until_explicitly_saved(client):
    """没存过主题时返回 null，而且读取不应把文件写出来。"""
    assert global_settings.read_theme() is None
    assert not global_settings._path().exists()

    response = client.get("/api/settings/global-theme")
    assert response.status_code == 200
    assert response.json() == {"theme": None}


def test_theme_roundtrip_keeps_profiles(client):
    """保存主题后 llm.profiles 仍在；PUT 返回同样的结构。"""
    client.post(
        "/api/settings/global-llm/profiles",
        json={"name": "日常", "config": {"base_url": "https://a/v1", "model": "m"}},
    )

    saved = client.put("/api/settings/global-theme", json={"theme": "dark"})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"theme": "dark"}
    assert client.get("/api/settings/global-theme").json() == {"theme": "dark"}

    summary = client.get("/api/settings/global-llm").json()
    assert [profile["name"] for profile in summary["profiles"]] == ["日常"]


def test_saving_llm_keeps_theme(client):
    """write_global_llm 是合并而不是重建：主题不会被模型配置抹掉。"""
    global_settings.write_theme("system")
    global_settings.write_global_llm(LLMConfig(base_url="https://a/v1", model="m", api_key="sk-a"))

    assert global_settings.read_theme() == "system"
    assert global_settings.read_global_llm().config.model == "m"


def test_theme_rejects_unknown_modes(client):
    assert client.put("/api/settings/global-theme", json={"theme": "midnight"}).status_code == 400
    assert client.put("/api/settings/global-theme", json={}).status_code == 400
    assert global_settings.read_theme() is None


def test_unknown_theme_value_in_file_reads_as_none():
    """手工改坏的文件不致命：只把主题当作未设置，llm 段照常可用。"""
    import json

    global_settings.write_theme("light")
    data = json.loads(global_settings._path().read_text(encoding="utf-8"))
    data["theme"] = "midnight"
    global_settings._path().write_text(json.dumps(data), encoding="utf-8")

    assert global_settings.read_theme() is None
