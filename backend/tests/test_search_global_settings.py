# SPDX-License-Identifier: Apache-2.0
"""联网搜索配置改全局（`global_settings.json` 顶层 `web_search`）的离线测试。

钉住四件事：

1. 升级后首次读取把当前数据集的旧 AppSetting 一次性迁移到全局，且只迁一次；
2. 全局块一旦存在就是唯一真相（旧行不再被读、也不再被写）；
3. 密钥三种口径（新值 / 掩码 / 空串）在全局文件里生效，落盘形态随平台
   （Windows = DPAPI 密文，其它平台按设计是明文，见 ``tests/api_key_at_rest.py``）；
4. 换一份数据集（= 该库的旧行不存在/不同）读到的仍是同一份全局配置。
"""

from __future__ import annotations

import json

from app.models.setting import AppSetting
from app.schemas.setting import SearchConfig
from app.services import global_settings
from app.services.api_key_crypto import encrypt_key
from app.services.llm_key_refs import API_KEY_MASK
from app.services.settings_service import (
    get_search_config,
    get_search_config_with_secrets,
    migrate_legacy_search_once,
    resolve_search_deepseek_key,
    save_search_config,
)
from app.services.web_search_settings import WEB_SEARCH_BLOCK
from tests.api_key_at_rest import assert_key_at_rest


def _seed_legacy(db_session, *, config: dict, key: str = "") -> None:
    """按升级前的形态写库：配置 JSON + 单独一行的加密密钥。"""
    db_session.add(AppSetting(key="search_config", value=json.dumps(config, ensure_ascii=False)))
    if key:
        db_session.add(AppSetting(key="search_deepseek_api_key", value=encrypt_key(key)))
    db_session.commit()


def _global_block() -> dict:
    state = global_settings.load_state() or {}
    block = state.get(WEB_SEARCH_BLOCK)
    assert isinstance(block, dict), "全局 web_search 段没有写出来"
    return block


def test_defaults_when_nothing_is_configured(db_session):
    config = get_search_config(db_session)
    assert config.sources == ["bing", "duckduckgo"]
    assert config.searxng_url == ""
    # P4-08：默认档位是「标准」（抓 2 页正文）。旧断言 `fetch_pages == 0` 已作废——
    # 只给摘要的搜索回答不了"这个岗位具体做什么"，这正是 09-1/09-2 要修的问题。
    # `fetch_pages` 仍按档位折算出来，好让旧前端读到的值不会把深度降回摘要。
    assert config.depth == "standard"
    assert config.fetch_pages == 2
    assert config.max_results == 8
    assert config.deepseek_api_key == ""
    # 真的一无所有时不写文件：没人希望升级后平白多一个 global_settings.json。
    assert not global_settings.path().exists()


def test_first_read_migrates_legacy_rows_to_global_once(db_session):
    _seed_legacy(
        db_session,
        config={
            "sources": ["bing", "searxng", "deepseek"],
            "searxng_url": "http://localhost:8080",
            "fetch_pages": 3,
            "max_results": 8,
            # 旧 JSON 里只可能是掩码；真实密钥在单独一行。
            "deepseek_api_key": API_KEY_MASK,
        },
        key="sk-legacy-secret",
    )

    config = get_search_config(db_session)
    assert config.sources == ["bing", "searxng", "deepseek"]
    assert config.searxng_url == "http://localhost:8080"
    # 旧 `fetch_pages=3` 读出来等价「深入」（P4-08 的只读兼容映射）。
    assert config.depth == "deep"
    assert config.fetch_pages == 3
    assert config.deepseek_api_key == API_KEY_MASK
    assert get_search_config_with_secrets(db_session).deepseek_api_key == "sk-legacy-secret"

    block = _global_block()
    assert block["sources"] == ["bing", "searxng", "deepseek"]
    assert block["depth"] == "deep"
    # 落盘**只写 depth**：两套深度值同时存在，迟早各说一套。
    assert "fetch_pages" not in block
    # 迁移后重新落盘：形态随平台（Windows = DPAPI 密文，其它平台按设计就是明文）。
    assert_key_at_rest(
        block["deepseek_api_key"],
        secret="sk-legacy-secret",
        raw=global_settings.path().read_text(encoding="utf-8"),
    )

    # 幂等：第二次读取 / 再调用迁移都不会重写（旧行保留但不再参与）。
    assert migrate_legacy_search_once(db_session) is False
    assert get_search_config(db_session).searxng_url == "http://localhost:8080"
    # 旧行**不删除**：回退旧版时仍能读到升级前的配置。
    assert db_session.get(AppSetting, "search_config") is not None


def test_masked_placeholder_without_a_key_row_migrates_as_no_key(db_session):
    """旧 JSON 里的 `********` 只是回显占位符；没有密钥行时它就是"没有 key"。"""
    _seed_legacy(
        db_session,
        config={
            "sources": ["bing", "deepseek"],
            "searxng_url": "",
            "fetch_pages": 0,
            "max_results": 8,
            "deepseek_api_key": API_KEY_MASK,
        },
    )

    config = get_search_config(db_session)
    assert config.sources == ["bing", "deepseek"]
    assert config.deepseek_api_key == ""
    assert _global_block()["deepseek_api_key"] == ""
    assert resolve_search_deepseek_key(db_session) == ""


def test_global_block_wins_over_legacy_rows(db_session):
    save_search_config(
        db_session,
        SearchConfig(sources=["duckduckgo"], searxng_url="", fetch_pages=1, max_results=8),
    )
    # 全局已存在时，旧行（哪怕被人改过）不再影响读取。
    _seed_legacy(
        db_session,
        config={
            "sources": ["bing"],
            "searxng_url": "http://legacy.example",
            "fetch_pages": 0,
            "max_results": 8,
            "deepseek_api_key": "",
        },
    )

    config = get_search_config(db_session)
    assert config.sources == ["duckduckgo"]
    assert config.searxng_url == ""
    # `fetch_pages=1` 折算成「标准」档；落盘只留 depth，回读时 fetch_pages 由档位反推（=2）。
    assert config.depth == "standard"
    assert migrate_legacy_search_once(db_session) is False


def test_save_writes_only_the_global_block(db_session):
    save_search_config(
        db_session,
        SearchConfig(sources=["bing", "deepseek"], max_results=8, deepseek_api_key="sk-new"),
    )

    # 旧 AppSetting 两行都不再生效，也不再被写。
    assert db_session.get(AppSetting, "search_config") is None
    assert db_session.get(AppSetting, "search_deepseek_api_key") is None
    assert _global_block()["sources"] == ["bing", "deepseek"]
    assert get_search_config_with_secrets(db_session).deepseek_api_key == "sk-new"


def test_key_three_way_semantics_in_the_global_block(db_session):
    # 新值 → 加密保存，回读是掩码。
    saved = save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key="sk-first")
    )
    assert saved.deepseek_api_key == API_KEY_MASK
    assert resolve_search_deepseek_key(db_session) == "sk-first"

    # 掩码原样回传 → 保留已存密钥。
    save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key=API_KEY_MASK)
    )
    assert resolve_search_deepseek_key(db_session) == "sk-first"

    # 空串 → 清除。
    cleared = save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key="")
    )
    assert cleared.deepseek_api_key == ""
    assert resolve_search_deepseek_key(db_session) == ""
    assert _global_block()["deepseek_api_key"] == ""


def test_another_dataset_reads_the_same_global_config(db_session):
    save_search_config(
        db_session,
        SearchConfig(
            sources=["bing", "searxng"],
            searxng_url="http://localhost:8888",
            fetch_pages=2,
            max_results=8,
        ),
    )
    # 模拟切到另一份数据集：那本库没有旧 search_config 行，但全局块照样生效。
    db_session.query(AppSetting).delete()
    db_session.commit()

    config = get_search_config(db_session)
    assert config.sources == ["bing", "searxng"]
    assert config.searxng_url == "http://localhost:8888"
    assert config.fetch_pages == 2


def test_corrupt_legacy_config_is_not_migrated(db_session):
    db_session.add(AppSetting(key="search_config", value="{not-json"))
    db_session.commit()

    config = get_search_config(db_session)
    assert config.sources == ["bing", "duckduckgo"]
    assert WEB_SEARCH_BLOCK not in (global_settings.load_state() or {})


def test_api_round_trip_returns_mask_and_persists_globally(db_session, client):
    # 升级路径也走接口：先放一份旧配置，第一次 GET 触发迁移。
    _seed_legacy(
        db_session,
        config={
            "sources": ["bing", "deepseek"],
            "searxng_url": "",
            "fetch_pages": 2,
            "max_results": 8,
            "deepseek_api_key": API_KEY_MASK,
        },
        key="sk-legacy-api",
    )

    first = client.get("/api/settings/search")
    assert first.status_code == 200
    payload = first.json()
    assert payload["sources"] == ["bing", "deepseek"]
    assert payload["fetch_pages"] == 2
    assert payload["deepseek_api_key"] == API_KEY_MASK
    assert "sk-legacy-api" not in first.text

    written = client.put(
        "/api/settings/search",
        json={
            "sources": ["bing", "searxng"],
            "searxng_url": "http://localhost:7777",
            "fetch_pages": 1,
            "max_results": 8,
            "deepseek_api_key": "sk-api-live",
        },
    )
    assert written.status_code == 200, written.text
    assert written.json()["deepseek_api_key"] == API_KEY_MASK
    assert "sk-api-live" not in written.text

    again = client.get("/api/settings/search").json()
    assert again["sources"] == ["bing", "searxng"]
    assert again["searxng_url"] == "http://localhost:7777"
    assert again["deepseek_api_key"] == API_KEY_MASK
    # 接口写进去的密钥落在同一份全局文件里，形态同样随平台（Windows = 密文，其它 = 明文）。
    assert_key_at_rest(
        _global_block()["deepseek_api_key"],
        secret="sk-api-live",
        raw=global_settings.path().read_text(encoding="utf-8"),
    )


def test_empty_key_round_trip_clears_the_stored_secret(db_session, client):
    save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key="sk-to-remove")
    )
    response = client.put(
        "/api/settings/search",
        json={"sources": ["deepseek"], "deepseek_api_key": ""},
    )
    assert response.status_code == 200
    assert response.json()["deepseek_api_key"] == ""
    assert resolve_search_deepseek_key(db_session) == ""
