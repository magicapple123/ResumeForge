# SPDX-License-Identifier: Apache-2.0
"""CR-13：旧配置路径的「标记 + 停止读取」。

联网搜索与语音转写曾经把配置存在**当前数据集**的 ``AppSetting`` 行里
（``search_config`` / ``search_deepseek_api_key`` / ``asr_config`` / ``asr_api_key``）。
升级后它们都在 ``global_settings.json`` 里全局一份，旧行只作回滚面包屑保留。

本文件钉住三步中的 ①②（③ 删行不在本轮）：

1. 诊断能列出本机还躺着哪几组旧行（不含值）；
2. 全局段存在时**绝不**再读旧行——「旧行为不再发生」；
3. 只有全局段缺失才回落，且回落必须留下 ``legacy-config-path`` 日志。
"""

from __future__ import annotations

import json
import logging

import pytest
from app.models.setting import AppSetting
from app.services import global_settings, settings_legacy
from app.services.api_key_crypto import encrypt_key
from app.services.asr_settings import get_asr_runtime_settings, resolve_asr_api_key
from app.services.settings_legacy import scan_legacy_paths
from app.services.settings_service import get_search_config
from app.services.web_search_settings import WEB_SEARCH_BLOCK

LEGACY_ASR_KEY = "sk-legacy-asr-0001"
LEGACY_SEARCH_KEY = "sk-legacy-search-0002"
LOGGER_NAME = "app.services.settings_legacy"


@pytest.fixture(autouse=True)
def _clear_notice_cache():
    """回落日志按段去重（否则每次转写都刷一行）；测试之间必须清掉这份进程内状态。"""
    settings_legacy._NOTIFIED.clear()
    yield
    settings_legacy._NOTIFIED.clear()


def _seed_legacy_search(db_session, *, sources: list[str] | None = None, key: str = "") -> None:
    db_session.add(
        AppSetting(
            key="search_config",
            value=json.dumps(
                {"sources": sources or ["bing"], "searxng_url": ""}, ensure_ascii=False
            ),
        )
    )
    if key:
        db_session.add(AppSetting(key="search_deepseek_api_key", value=encrypt_key(key)))
    db_session.commit()


def _seed_legacy_asr(db_session, *, base_url: str = "https://asr.legacy.example/v1") -> None:
    db_session.add(
        AppSetting(
            key="asr_config",
            value=json.dumps(
                {"base_url": base_url, "model": "whisper-1", "protocol": "openai"},
                ensure_ascii=False,
            ),
        )
    )
    db_session.add(AppSetting(key="asr_api_key", value=encrypt_key(LEGACY_ASR_KEY)))
    db_session.commit()


def _set_global(key: str, value: dict) -> None:
    global_settings.mutate_state(lambda state: state.__setitem__(key, value))


# ----- ① 标记：诊断能列出旧行 -----


def test_diagnostic_scan_is_empty_on_a_clean_machine(db_session):
    report = scan_legacy_paths(db_session)
    assert report == {"count": 0, "items": []}


def test_diagnostic_scan_lists_legacy_sections_without_their_values(db_session):
    _seed_legacy_search(db_session, sources=["bing"], key=LEGACY_SEARCH_KEY)
    _seed_legacy_asr(db_session)

    report = scan_legacy_paths(db_session)

    assert report["count"] == 2
    sections = {item["section"]: item for item in report["items"]}
    assert set(sections) == {"web_search", "asr"}
    assert "search_config" in sections["web_search"]["keys"]
    assert "asr_api_key" in sections["asr"]["keys"]
    # 诊断只报"哪些行还在"，绝不带值——旧行里有密文 Key。
    assert LEGACY_SEARCH_KEY not in json.dumps(report)
    assert LEGACY_ASR_KEY not in json.dumps(report)


def test_diagnostics_endpoint_exposes_the_legacy_scan(client, db_session):
    _seed_legacy_asr(db_session)

    response = client.get("/api/system/diagnostics")

    assert response.status_code == 200
    legacy = response.json()["legacy_config"]
    assert legacy["count"] == 1
    assert legacy["items"][0]["section"] == "asr"


# ----- ② 停止读取：全局段存在就绝不看旧行 -----


def test_asr_never_reads_legacy_rows_once_the_profiles_section_exists(db_session, caplog):
    _seed_legacy_asr(db_session)
    # 段存在但**没有任何配置**（用户删光了）：这正是"删光不该被旧值复活"的场景。
    _set_global("asr_profiles", {"version": 1, "active_profile_id": "", "profiles": []})

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        assert get_asr_runtime_settings(db_session).base_url == ""
        assert resolve_asr_api_key(db_session) == ""

    assert "legacy-config-path" not in caplog.text


def test_search_never_reads_legacy_rows_once_the_global_block_exists(db_session, caplog):
    _seed_legacy_search(db_session, sources=["bing"], key=LEGACY_SEARCH_KEY)
    _set_global(
        WEB_SEARCH_BLOCK,
        {"sources": ["duckduckgo"], "searxng_url": "", "deepseek_api_key": ""},
    )

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        config = get_search_config(db_session)

    assert config.sources == ["duckduckgo"]
    assert "legacy-config-path" not in caplog.text


# ----- ② 回落：只在全局缺失时发生，并且记日志 -----


def test_asr_fallback_is_logged_when_the_global_section_is_missing(db_session, caplog):
    _seed_legacy_asr(db_session)

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        assert resolve_asr_api_key(db_session) == LEGACY_ASR_KEY
        # 同一段再读一次不重复刷日志。
        assert resolve_asr_api_key(db_session) == LEGACY_ASR_KEY

    warnings = [record for record in caplog.records if "legacy-config-path" in record.message]
    assert len(warnings) == 1
    assert "asr" in warnings[0].message


def test_search_fallback_is_logged_when_it_migrates_legacy_rows(db_session, caplog):
    _seed_legacy_search(db_session, sources=["bing"], key=LEGACY_SEARCH_KEY)

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        config = get_search_config(db_session)

    assert config.sources == ["bing"]
    assert "legacy-config-path" in caplog.text
