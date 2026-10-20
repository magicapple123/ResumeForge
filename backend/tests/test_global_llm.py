# SPDX-License-Identifier: Apache-2.0
"""全局模型配置（C）：一份配置，所有数据集共用。

为什么值得单独一批测试：这条链路决定"实际调用哪个模型"。写坏了不会崩，只会让用户在
B 数据集里悄悄用上 A 数据集的模型/额度——最难发现的一类问题。

本批的变化：R21 的「全局模型」开关与独立 profiles 端点已删除，原「大模型 API 配置」
模块整体提到全局。因此这里钉住四组性质：

1. 生效顺序：全局记录优先；没有全局时回退数据集旧配置（升级后行为不变）；
2. 记录 CRUD：同名 upsert、使用中切换、删除当前记录后自动落到下一条；
3. 密钥：接口只回引用占位符；留空保留、``__clear__`` 才清空；文件里不是明文（Windows）；
4. 一次性迁移：数据集里的旧记录/当前配置搬到全局，标记之后不再重复导入。
"""

from __future__ import annotations

import json
import sys

import pytest
from app.schemas.setting import LLMConfig
from app.services import global_settings
from app.services.api_key_crypto import encrypt_key
from app.services.global_llm_profiles import read_global_llm, write_global_llm
from app.services.settings_service import (
    get_dataset_llm_config,
    get_llm_config,
    save_llm_config,
)


@pytest.fixture(autouse=True)
def global_dir(tmp_path, monkeypatch):
    """全局配置写到用例自己的目录，别碰开发机的 data/。"""
    monkeypatch.setattr(global_settings, "DATA_DIR", str(tmp_path))
    assert global_settings.path().parent == tmp_path
    return tmp_path


def _dataset_config(db_session, *, model: str = "dataset-model") -> None:
    save_llm_config(
        db_session,
        LLMConfig(
            base_url="https://dataset.example/v1",
            model=model,
            api_key="sk-dataset",
        ),
    )


def _add_dataset_record(db_session, name: str, model: str, key: str = "sk-old") -> None:
    from app.models.setting import LLMConfigRecord

    db_session.add(
        LLMConfigRecord(
            name=name,
            base_url="https://old.example/v1",
            model=model,
            api_key=encrypt_key(key),
        )
    )
    db_session.commit()


def test_global_config_wins_over_dataset(client, db_session):
    _dataset_config(db_session)
    write_global_llm(
        LLMConfig(base_url="https://global.example/v1", model="global-model", api_key="sk-global")
    )

    effective = get_llm_config(db_session)
    assert effective.base_url == "https://global.example/v1"
    assert effective.model == "global-model"
    # 数据集自己的那份没被动过。
    assert get_dataset_llm_config(db_session).model == "dataset-model"


def test_without_global_falls_back_to_dataset(client, db_session):
    _dataset_config(db_session)

    assert get_llm_config(db_session).model == "dataset-model"
    response = client.get("/api/settings/llm")
    assert response.status_code == 200
    assert response.json()["scope"] == "dataset"
    assert response.json()["model"] == "dataset-model"


def test_incomplete_global_config_is_ignored(client, db_session):
    _dataset_config(db_session)
    # 只有地址没有模型：让这样的配置接管，等于把用户的调用全打到 404 上。
    write_global_llm(LLMConfig(base_url="https://global.example/v1", model=""))

    assert get_llm_config(db_session).model == "dataset-model"


def test_corrupt_file_is_ignored_not_fatal(client, db_session):
    _dataset_config(db_session)
    global_settings.path().write_text("{不是 JSON", encoding="utf-8")

    assert get_llm_config(db_session).model == "dataset-model"
    assert read_global_llm() is None


def test_put_masks_key_keeps_it_when_blank_and_clears_on_explicit_request(client, db_session):
    saved = client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://global.example/v1",
            "model": "global-model",
            "api_key": "sk-global",
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["scope"] == "global"
    assert body["record_id"].startswith("p_")
    assert body["record_name"] == "默认配置"
    assert body["api_key"].startswith("********:profile:")
    assert "sk-global" not in saved.text

    # 双写：当前数据集还留着一份快照（换机器/回滚时至少能继续用）。
    assert get_dataset_llm_config(db_session).model == "global-model"

    # 落盘形态随平台：Windows 只有 DPAPI 密文，其它平台（无 DPAPI）按设计就是明文。
    raw = global_settings.path().read_text(encoding="utf-8")
    if sys.platform == "win32":
        assert "sk-global" not in raw
    else:
        assert "sk-global" in raw, "非 Windows 平台按设计保持明文，改了就同步 CHANGELOG"

    # 留空 = 保留原密钥（模型改名不影响密钥）。
    kept = client.put(
        "/api/settings/llm",
        json={"base_url": "https://global.example/v1", "model": "m2"},
    )
    assert kept.status_code == 200, kept.text
    assert read_global_llm().config.api_key == "sk-global"

    # 显式 __clear__ 才清空。
    cleared = client.put(
        "/api/settings/llm",
        json={
            "base_url": "https://global.example/v1",
            "model": "m2",
            "api_key": "__clear__",
        },
    )
    assert cleared.status_code == 200, cleared.text
    assert read_global_llm().config.api_key == ""


def test_record_crud_and_active_switch(client):
    first = client.post(
        "/api/settings/llm/records",
        json={
            "name": "DeepSeek 日常",
            "base_url": "https://a.example/v1",
            "model": "a-model",
            "api_key": "sk-a",
            "models": ["a-model"],
        },
    )
    assert first.status_code == 200, first.text
    first_record = first.json()
    first_id = first_record["id"]
    assert first_id.startswith("p_")
    assert first_record["is_active"] is True
    # 记录里任何一层都不能出现密钥。
    assert "sk-a" not in first.text

    second = client.post(
        "/api/settings/llm/records",
        json={"name": "备用", "base_url": "https://b.example/v1", "model": "b-model"},
    )
    assert second.status_code == 200, second.text
    records = client.get("/api/settings/llm/records").json()
    assert len(records) == 2
    second_id = next(item["id"] for item in records if item["name"] == "备用")

    # 切换：active 变化，且实际读到的配置跟着变。
    activated = client.post(f"/api/settings/llm/records/{second_id}/activate")
    assert activated.status_code == 200, activated.text
    assert activated.json()["is_active"] is True
    assert read_global_llm().config.model == "b-model"

    # 同名 upsert：更新而不是新增，且留空 api_key 保留原密钥。
    upserted = client.post(
        "/api/settings/llm/records",
        json={"name": "备用", "base_url": "https://b.example/v1", "model": "b-model-2"},
    )
    assert upserted.status_code == 200, upserted.text
    assert len(client.get("/api/settings/llm/records").json()) == 2
    assert read_global_llm().config.api_key == ""

    # 删除当前 active：自动切到剩下的第一个。
    assert client.delete(f"/api/settings/llm/records/{second_id}").status_code == 204
    remaining = client.get("/api/settings/llm/records").json()
    assert [item["id"] for item in remaining] == [first_id]
    assert remaining[0]["is_active"] is True

    # 最后一个也删：回到未配置，不会留下空记录冒充生效。
    assert client.delete(f"/api/settings/llm/records/{first_id}").status_code == 204
    assert client.get("/api/settings/llm/records").json() == []
    assert read_global_llm() is None


def test_record_endpoints_reject_unknown_ids_and_bad_fields(client):
    assert client.delete("/api/settings/llm/records/p_nope").status_code == 404
    assert client.post("/api/settings/llm/records/p_nope/activate").status_code == 404
    assert (
        client.post(
            "/api/settings/llm/records",
            json={"name": "   ", "base_url": "https://a/v1", "model": "m"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/settings/llm/records",
            json={"name": "坏配置", "base_url": "https://a/v1", "model": "m", "temperature": 9},
        ).status_code
        == 400
    )


def test_migration_imports_dataset_records_once(client, db_session):
    """首次打开设置页：旧记录 + 当前生效配置一起搬进全局，当前配置设为使用中。"""
    _add_dataset_record(db_session, "旧记录甲", "old-a")
    _add_dataset_record(db_session, "旧记录乙", "old-b")
    _dataset_config(db_session)

    records = client.get("/api/settings/llm/records").json()
    names = [item["name"] for item in records]
    assert "旧记录甲" in names and "旧记录乙" in names
    assert "默认配置" in names
    assert next(item for item in records if item["name"] == "默认配置")["is_active"] is True
    assert read_global_llm().config.model == "dataset-model"

    # 用户删光之后不会再次自动导入（标记已写）。
    for item in records:
        assert client.delete(f"/api/settings/llm/records/{item['id']}").status_code == 204
    assert client.get("/api/settings/llm/records").json() == []
    assert read_global_llm() is None

    # 数据集里的旧表仍在（保留回滚能力），迁移不删数据。
    from app.models.setting import LLMConfigRecord

    assert db_session.query(LLMConfigRecord).count() == 2


def test_migration_does_not_touch_existing_global_records(client, db_session):
    """R21 老用户已经有全局 profiles：只补标记，不被数据集旧记录覆盖。"""
    client.post(
        "/api/settings/llm/records",
        json={"name": "新世界", "base_url": "https://new/v1", "model": "new-model"},
    )
    _add_dataset_record(db_session, "旧记录", "old-model")

    records = client.get("/api/settings/llm/records").json()
    assert [item["name"] for item in records] == ["新世界"]


def test_v1_file_is_migrated_to_a_single_profile_on_read():
    """升级后第一次读取：v1 的单配置自动变成一个 profile，并写回 v2。"""
    payload = {
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
    path = global_settings.path()
    path.write_text(json.dumps(payload), encoding="utf-8")

    loaded = read_global_llm()
    assert loaded is not None
    assert loaded.config.model == "legacy-model"
    assert loaded.config.api_key == "sk-legacy"
    assert loaded.name == "默认配置"

    migrated = json.loads(path.read_text(encoding="utf-8"))
    assert migrated["version"] == global_settings.GLOBAL_SETTINGS_VERSION
    assert migrated["llm"]["active_profile_id"] == loaded.profile_id


def test_v1_write_back_failure_still_reads(monkeypatch):
    """迁移写回失败只记 warning：不能因此让用户升级后配置消失。"""
    payload = {
        "version": 1,
        "llm": {
            "enabled": True,
            "config": {"base_url": "https://legacy/v1", "model": "legacy-model"},
        },
    }
    path = global_settings.path()
    path.write_text(json.dumps(payload), encoding="utf-8")

    def _boom(_state):
        raise OSError("disk full")

    from app.services import global_llm_profiles

    monkeypatch.setattr(global_settings, "write_state_unlocked", _boom)
    monkeypatch.setattr(global_llm_profiles, "write_state_unlocked", _boom)

    loaded = read_global_llm()
    assert loaded is not None
    assert loaded.config.model == "legacy-model"


def test_concurrent_writes_keep_the_file_valid():
    """20 个线程同时写：锁 + 随机临时文件，最终必须是合法 JSON 且只有一个 profile。"""
    from concurrent.futures import ThreadPoolExecutor

    def _write(index: int) -> None:
        write_global_llm(
            LLMConfig(
                base_url=f"https://t{index}.example/v1",
                model=f"model-{index}",
                api_key=f"sk-{index}",
            )
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(_write, range(20)))

    data = json.loads(global_settings.path().read_text(encoding="utf-8"))
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
    assert not global_settings.path().exists()

    response = client.get("/api/settings/global-theme")
    assert response.status_code == 200
    assert response.json() == {"theme": None}


def test_theme_roundtrip_keeps_profiles(client):
    """保存主题后 llm.profiles 仍在；PUT 返回同样的结构。"""
    client.post(
        "/api/settings/llm/records",
        json={"name": "日常", "base_url": "https://a/v1", "model": "m"},
    )

    saved = client.put("/api/settings/global-theme", json={"theme": "dark"})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"theme": "dark"}
    assert client.get("/api/settings/global-theme").json() == {"theme": "dark"}

    assert [item["name"] for item in client.get("/api/settings/llm/records").json()] == ["日常"]


def test_saving_llm_keeps_theme(client):
    """write_global_llm 是合并而不是重建：主题不会被模型配置抹掉。"""
    global_settings.write_theme("system")
    write_global_llm(LLMConfig(base_url="https://a/v1", model="m", api_key="sk-a"))

    assert global_settings.read_theme() == "system"
    assert read_global_llm().config.model == "m"


def test_theme_rejects_unknown_modes(client):
    assert client.put("/api/settings/global-theme", json={"theme": "midnight"}).status_code == 400
    assert client.put("/api/settings/global-theme", json={}).status_code == 400
    assert global_settings.read_theme() is None


def test_unknown_theme_value_in_file_reads_as_none():
    """手工改坏的文件不致命：只把主题当作未设置，llm 段照常可用。"""
    global_settings.write_theme("light")
    data = json.loads(global_settings.path().read_text(encoding="utf-8"))
    data["theme"] = "midnight"
    global_settings.path().write_text(json.dumps(data), encoding="utf-8")

    assert global_settings.read_theme() is None
