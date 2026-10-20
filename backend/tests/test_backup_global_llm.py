"""全局模型配置随备份包导出/导入。

用户需求（2026-10-19）：导出数据集时**默认携带当前所有全局模型配置**，并可在导出前
取消；导入时把配置合并回来。这里钉住四件事：

1. 默认导出全部记录 + `active_profile_id`，格式号升到 5（旧版本明确拒收）；
2. 取消勾选时不写成员，包格式与旧版完全一致；
3. `include_api_keys=false` 时包内不出现任何密钥（哪怕是密文）；
4. 导入只补不覆盖：同名且本地已有内容的记录保留本地，空壳记录被补全，
   本地没有「使用中」时才采纳包内的 active。
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from app.database import engine
from app.schemas.setting import LLMConfig
from app.services.data_backup import (
    BACKUP_FORMAT_GLOBAL_CONFIG,
    GLOBAL_LLM_MEMBER,
    MANIFEST_MEMBER,
    create_backup_archive,
)
from app.services.datasets import export_all_datasets
from app.services.global_llm_profiles import (
    list_records,
    merge_exported_profiles,
    read_global_llm,
    upsert_record,
    write_global_llm,
)


def _member(archive: Path, name: str) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(name))


def _names(payload: dict) -> set[str]:
    return {item["name"] for item in payload["profiles"]}


def _seed_two_records() -> None:
    write_global_llm(LLMConfig(base_url="https://a.example/v1", model="a-model", api_key="sk-a"))
    upsert_record(
        "备用",
        LLMConfig(base_url="https://b.example/v1", model="b-model", api_key="sk-b"),
    )


def test_export_carries_all_records_and_bumps_the_format(tmp_path):
    _seed_two_records()

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    manifest = _member(archive, MANIFEST_MEMBER)
    payload = _member(archive, GLOBAL_LLM_MEMBER)

    assert manifest["format"] == BACKUP_FORMAT_GLOBAL_CONFIG == 5
    assert manifest["global_llm"] == {"profiles": 2}
    assert _names(payload) == {"默认配置", "备用"}
    assert payload["active_profile_id"] == read_global_llm().profile_id
    # 没勾"包含密钥"：包内任何一条都不能出现密钥原文，也不能出现密文。
    for item in payload["profiles"]:
        assert item["config"]["api_key"] == ""
    raw = json.dumps(payload)
    assert "sk-a" not in raw and "sk-b" not in raw


def test_export_keeps_stored_keys_when_the_user_opts_in(tmp_path):
    _seed_two_records()

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=True, include_global_llm=True
    )
    payload = _member(archive, GLOBAL_LLM_MEMBER)

    # 同一台机器上导出：密钥按存储形态带回，导入后能直接用。
    assert all(item["config"]["api_key"] for item in payload["profiles"])


def test_roundtrip_keeps_the_key_usable_on_the_same_machine(tmp_path):
    """带密钥导出 → 清空 → 导回：密钥不能因为"又加密了一次"而失效。"""
    _seed_two_records()
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=True, include_global_llm=True
    )
    payload = _member(archive, GLOBAL_LLM_MEMBER)

    from app.services.global_llm_profiles import delete_record

    for record in list_records():
        delete_record(record["id"])
    assert read_global_llm() is None

    merge_exported_profiles(payload)
    restored = read_global_llm()
    assert restored is not None
    # 同一台机器上必须解出原密钥；二次加密会在这里变成密文串。
    assert restored.config.api_key == "sk-a"
    assert restored.config.model == "a-model"


def test_export_without_global_config_keeps_the_old_format(tmp_path):
    _seed_two_records()

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=False
    )
    manifest = _member(archive, MANIFEST_MEMBER)
    with zipfile.ZipFile(archive) as handle:
        assert GLOBAL_LLM_MEMBER not in handle.namelist()
    assert manifest["format"] != BACKUP_FORMAT_GLOBAL_CONFIG
    assert "global_llm" not in manifest


def test_collection_archive_carries_one_copy_at_the_outer_level(tmp_path):
    _seed_two_records()

    archive = export_all_datasets(engine, tmp_path, include_global_llm=True)
    manifest = _member(archive, MANIFEST_MEMBER)
    payload = _member(archive, GLOBAL_LLM_MEMBER)

    assert manifest["format"] == BACKUP_FORMAT_GLOBAL_CONFIG
    assert manifest["global_llm"] == {"profiles": 2}
    assert _names(payload) == {"默认配置", "备用"}
    # 子包各自是普通单数据集包：配置只在最外层出现一次。
    with zipfile.ZipFile(archive) as handle:
        sub_names = [name for name in handle.namelist() if name.endswith(".zip")]
        assert sub_names
        for name in sub_names:
            with zipfile.ZipFile(io.BytesIO(handle.read(name))) as sub:
                assert GLOBAL_LLM_MEMBER not in sub.namelist()


def test_merge_adds_new_records_and_never_overwrites_a_used_one():
    write_global_llm(
        LLMConfig(base_url="https://local.example/v1", model="local-model", api_key="sk-local")
    )
    payload = {
        "format": 1,
        "active_profile_id": "src-b",
        "profiles": [
            {
                "id": "src-a",
                "name": "默认配置",
                "config": {
                    "base_url": "https://other.example/v1",
                    "model": "other-model",
                    "api_key": "sk-other",
                },
            },
            {
                "id": "src-b",
                "name": "备用",
                "config": {"base_url": "https://b.example/v1", "model": "b-model"},
            },
        ],
    }

    result = merge_exported_profiles(payload)

    assert result == {
        "imported": 1,
        "updated": 0,
        "skipped": 1,
        "invalid": 0,
        "active": False,
        "profiles": 1,
    }
    assert _names({"profiles": list_records()}) == {"默认配置", "备用"}
    # 同名的那条保留本地端点与密钥（不被别的机器覆盖）。
    current = read_global_llm()
    assert current.config.model == "local-model"
    assert current.config.api_key == "sk-local"


def test_merge_fills_an_empty_shell_and_adopts_its_active():
    upsert_record("默认配置", LLMConfig())  # 真实用户数据里常见的"点开过但没填"
    shell = read_global_llm()
    assert shell is not None and shell.config.model == ""  # 空壳存在，但不是可用配置

    payload = {
        "format": 1,
        "active_profile_id": "src",
        "profiles": [
            {
                "id": "src",
                "name": "默认配置",
                "config": {"base_url": "https://restored/v1", "model": "restored-model"},
            }
        ],
    }

    result = merge_exported_profiles(payload)

    assert result["updated"] == 1
    assert result["active"] is True
    restored = read_global_llm()
    assert restored is not None
    assert restored.config.model == "restored-model"


def test_merge_keeps_local_active_when_it_already_has_content():
    write_global_llm(LLMConfig(base_url="https://keep/v1", model="keep-model"))
    local_id = read_global_llm().profile_id
    payload = {
        "active_profile_id": "src",
        "profiles": [
            {"id": "src", "name": "别的", "config": {"base_url": "https://x/v1", "model": "x"}}
        ],
    }

    result = merge_exported_profiles(payload)

    assert result["imported"] == 1
    assert result["active"] is False
    assert read_global_llm().profile_id == local_id


def test_api_import_attaches_the_merge_report(client, tmp_path):
    _seed_two_records()
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    # 先清空本地记录，模拟"换一台机器恢复"：两条都应作为新增导入。
    from app.services.global_llm_profiles import delete_record

    for record in list_records():
        delete_record(record["id"])
    assert list_records() == []

    response = client.post(
        "/api/settings/datasets/import?name=restored",
        content=archive.read_bytes(),
        headers={"Content-Type": "application/zip"},
    )

    assert response.status_code == 200, response.text
    report = response.json()["global_llm"]
    assert report["imported"] == 2
    assert report["profiles"] == 2
    assert _names({"profiles": list_records()}) == {"默认配置", "备用"}
