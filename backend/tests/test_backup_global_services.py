# SPDX-License-Identifier: Apache-2.0
"""CR-10：备份带上语音 / 语义检索 / 联网搜索 / 代理四块服务配置。

换机恢复后这四块原本全丢——语音要重填、语义检索配置没了、三把搜索 Key 与代理也要
重配。这里钉住五件事：

1. 导出写 ``global_services.json``，包格式升到 7（旧版本明确拒收，不静默丢配置）；
2. ``include_api_keys=False`` 时四块结构都在、密钥字段全空，且**整包里搜不到明文**；
3. 只带一块（例如只配了搜索）也照样写成员，不会因为别处为空就整段不带；
4. 恢复到本机：空的地方补上、已有内容不被别的机器覆盖，报告逐块给计数；
5. 旧包（没有这个成员）照常导入，不炸。
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from app.database import engine
from app.schemas.asr import AsrProfileIn
from app.schemas.setting import SearchConfig
from app.services import net_settings
from app.services.api_key_crypto import encrypt_key
from app.services.asr_profiles import list_asr_profiles, save_asr_profile
from app.services.data_backup import (
    BACKUP_FORMAT_VERSION,
    MANIFEST_MEMBER,
    BackupError,
    create_backup_archive,
)
from app.services.global_settings import mutate_state
from app.services.web_search_settings import get_search_config, save_search_config

ASR_KEY = "sk-asr-secret-0001"
EMBEDDING_KEY = "sk-embedding-secret-0002"
SEARCH_KEY = "sk-search-secret-0003"
TAVILY_KEY = "tvly-secret-0004"
PROXY_PASSWORD = "proxy-secret-0005"
GLOBAL_SERVICES_MEMBER = "global_services.json"


def _member(archive: Path, name: str) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(name))


def _member_names(archive: Path) -> set[str]:
    with zipfile.ZipFile(archive) as handle:
        return set(handle.namelist())


def _plaintext_anywhere(archive: Path, needles: list[str]) -> list[str]:
    """在**每个成员**里搜明文密钥（含二进制成员），返回命中的成员名。"""
    hits: list[str] = []
    with zipfile.ZipFile(archive) as handle:
        for name in handle.namelist():
            raw = handle.read(name)
            if any(needle.encode() in raw for needle in needles):
                hits.append(name)
    return hits


def _seed_four_sections(db_session) -> None:
    save_asr_profile(
        AsrProfileIn(
            name="公司语音",
            base_url="https://asr.example/v1",
            model="whisper-1",
            api_key=ASR_KEY,
        ),
        activate=True,
    )
    save_search_config(
        db_session,
        SearchConfig(
            sources=["bing"],
            deepseek_api_key=SEARCH_KEY,
            tavily_api_key=TAVILY_KEY,
        ),
    )
    mutate_state(
        lambda state: state.__setitem__(
            "embedding_profiles",
            {
                "section_version": 1,
                "active_profile_id": "e_seed01",
                "profiles": [
                    {
                        "id": "e_seed01",
                        "name": "公司向量",
                        "config": {
                            "provider": "openai",
                            "model": "text-embedding-3-small",
                            "base_url": "https://emb.example/v1",
                            "api_key": encrypt_key(EMBEDDING_KEY),
                        },
                    }
                ],
            },
        )
    )
    net_settings.save(
        mode="custom",
        proxy_url="http://127.0.0.1:7890",
        username="proxy-user",
        password=PROXY_PASSWORD,
    )


def test_export_writes_the_member_and_bumps_the_format(tmp_path, db_session):
    _seed_four_sections(db_session)

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )

    assert GLOBAL_SERVICES_MEMBER in _member_names(archive)
    manifest = _member(archive, MANIFEST_MEMBER)
    assert manifest["format"] == BACKUP_FORMAT_VERSION == 7
    assert manifest["global_services"]["version"] == 1
    payload = _member(archive, GLOBAL_SERVICES_MEMBER)
    assert set(payload["services"]) == {
        "asr_profiles",
        "embedding_profiles",
        "web_search",
        "network",
    }


def test_export_without_keys_keeps_structure_and_leaks_nothing(tmp_path, db_session):
    _seed_four_sections(db_session)

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    services = _member(archive, GLOBAL_SERVICES_MEMBER)["services"]

    assert services["asr_profiles"]["profiles"][0]["api_key"] == ""
    assert services["embedding_profiles"]["profiles"][0]["config"]["api_key"] == ""
    assert services["web_search"]["deepseek_api_key"] == ""
    assert services["web_search"]["tavily_api_key"] == ""
    assert services["network"]["proxy_password"] == ""
    # 结构（地址 / 模型 / 代理端口）不能跟着密钥一起丢。
    assert services["asr_profiles"]["profiles"][0]["base_url"] == "https://asr.example/v1"
    assert services["network"]["proxy_url"] == "http://127.0.0.1:7890"
    assert services["web_search"]["sources"] == ["bing"]
    # 密钥原文在包内任何成员里都搜不到（含 manifest / 数据库快照）。
    assert (
        _plaintext_anywhere(
            archive, [ASR_KEY, EMBEDDING_KEY, SEARCH_KEY, TAVILY_KEY, PROXY_PASSWORD]
        )
        == []
    )


def test_member_is_written_even_when_only_one_section_is_configured(tmp_path, db_session):
    net_settings.save(mode="direct")

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )

    assert GLOBAL_SERVICES_MEMBER in _member_names(archive)
    services = _member(archive, GLOBAL_SERVICES_MEMBER)["services"]
    assert services["network"]["proxy_mode"] == "direct"
    assert "asr_profiles" not in services or not services["asr_profiles"].get("profiles")


def test_restore_brings_the_four_sections_back(tmp_path, db_session):
    _seed_four_sections(db_session)
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    # 模拟"换了一台什么都没配的机器"。
    mutate_state(
        lambda state: [
            state.pop("asr_profiles", None),
            state.pop("embedding_profiles", None),
            state.pop("web_search", None),
            state.pop("network", None),
        ]
    )
    assert list_asr_profiles().profiles == []

    from app.services.data_backup.global_services import (
        read_global_services_payload,
        restore_global_services,
    )

    report = restore_global_services(read_global_services_payload(archive))

    assert report["asr_profiles"]["imported"] == 1
    assert report["embedding_profiles"]["imported"] == 1
    assert report["web_search"] is True
    assert report["network"] is True
    assert [item.name for item in list_asr_profiles().profiles] == ["公司语音"]
    assert net_settings.read().proxy_url == "http://127.0.0.1:7890"
    assert get_search_config(db_session).sources == ["bing"]
    # 没带密钥（include_api_keys=False）：四块结构回来了，Key 明确要求重填。
    assert "重填" in report["key_notice"]


def test_restore_reports_that_imported_keys_may_not_decrypt(tmp_path, db_session):
    """带 Key 的包换机恢复：Key 是 DPAPI 密文，报告必须提示"可能无法解密，请重填"。

    不写这句的后果：用户看到"恢复了 4 项服务配置"就去用，第一次转写才报鉴权失败，
    而且完全不知道是"换机导致密文解不开"。
    """
    from app.services.data_backup.global_services import (
        read_global_services_payload,
        restore_global_services,
    )

    _seed_four_sections(db_session)
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=True, include_global_llm=True
    )
    # 模拟"换机会解不开"：只验证报告口径，不去构造真正解不开的密文。
    mutate_state(lambda state: state.pop("network", None))

    report = restore_global_services(read_global_services_payload(archive))

    assert report["keys_included"] is True
    assert "无法解密" in report["key_notice"]
    assert "重填" in report["key_notice"]


def test_restore_never_overwrites_a_local_section_that_has_content(tmp_path, db_session):
    _seed_four_sections(db_session)
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    net_settings.save(mode="custom", proxy_url="http://10.0.0.9:8888")

    from app.services.data_backup.global_services import (
        read_global_services_payload,
        restore_global_services,
    )

    restore_global_services(read_global_services_payload(archive))

    # 本机已填的代理地址优先；包里的不覆盖别人正在用的出口。
    assert net_settings.read().proxy_url == "http://10.0.0.9:8888"


def test_old_archive_without_the_member_still_imports(tmp_path, db_session):
    """格式 6 的包没有这个成员：导入必须照常成功，四块保持本机原样。"""
    from app.services.datasets import import_dataset

    _seed_four_sections(db_session)
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    legacy = tmp_path / "legacy-format-6.zip"
    with (
        zipfile.ZipFile(archive) as source,
        zipfile.ZipFile(legacy, "w", zipfile.ZIP_DEFLATED) as target,
    ):
        for info in source.infolist():
            raw = source.read(info.filename)
            if info.filename == GLOBAL_SERVICES_MEMBER:
                continue
            if info.filename == MANIFEST_MEMBER:
                manifest = json.loads(raw)
                manifest["format"] = 6
                manifest.pop("global_services", None)
                raw = json.dumps(manifest, ensure_ascii=False).encode()
            target.writestr(info.filename, raw)

    result = import_dataset(legacy, "旧包", engine, tmp_path / "staging")

    assert result["id"]


def test_format_seven_archive_imports_end_to_end(tmp_path, db_session):
    """新格式自己必须读得回：导出 → 导入，四块结构与清单段都在。

    旧版本拒收新包这件事由导入侧的 ``format > BACKUP_FORMAT_VERSION`` 一处判定，
    见 ``test_newer_format_is_rejected_with_an_upgrade_hint``。
    """
    from app.services.datasets import import_dataset

    _seed_four_sections(db_session)
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    assert _member(archive, MANIFEST_MEMBER)["format"] == 7

    result = import_dataset(archive, "格式 7", engine, tmp_path / "staging")

    assert result["id"]


def test_newer_format_is_rejected_with_an_upgrade_hint(tmp_path, db_session):
    _seed_four_sections(db_session)
    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )
    future = tmp_path / "future.zip"
    with (
        zipfile.ZipFile(archive) as source,
        zipfile.ZipFile(future, "w", zipfile.ZIP_DEFLATED) as target,
    ):
        for info in source.infolist():
            raw = source.read(info.filename)
            if info.filename == MANIFEST_MEMBER:
                manifest = json.loads(raw)
                manifest["format"] = BACKUP_FORMAT_VERSION + 1
                raw = json.dumps(manifest, ensure_ascii=False).encode()
            target.writestr(info.filename, raw)

    from app.services.datasets import import_dataset

    with pytest.raises(BackupError, match="更新版本"):
        import_dataset(future, "未来包", engine, tmp_path / "staging")
