# SPDX-License-Identifier: Apache-2.0
"""CR-07：密钥前后 4 位提示 + 一键复制。

要求与边界（任务书 CR-07 + §9 口径）：

- 只为展示加**只读** ``hint``：前 4 位 + ``****`` + 后 4 位，短于 16 位回退 ``********``；
- ``********`` 这个掩码字面量**不改**，写回语义（掩码=保持不变）也不改；
- 语义检索也给 hint（它的 ``masked`` 仍是空串，配置卡只回布尔的历史口径不动）；
- 复制由后端直写剪贴板，响应只 ``{ok: true}``，**明文不出现在任何响应**；
- 不做"眼睛"揭示完整 Key。
"""

from __future__ import annotations

import pytest
from app.database import engine
from app.schemas.asr import AsrProfileIn
from app.schemas.setting import SearchConfig
from app.services import net_settings
from app.services.asr_profiles import save_asr_profile
from app.services.credentials.semantics import mask_value
from app.services.llm_key_refs import API_KEY_MASK
from app.services.web_search_settings import save_search_config

DEEPSEEK_KEY = "sk-abcdef1234567890bb44"
SHORT_KEY = "sk-short"


def _items(client) -> dict[str, dict]:
    payload = client.get("/api/connections").json()
    return {item["id"]: item for group in payload["groups"] for item in group["items"]}


def test_hint_shows_the_first_and_last_four_characters(client, db_session):
    save_search_config(db_session, SearchConfig(deepseek_api_key=DEEPSEEK_KEY))

    item = _items(client)["web_search.deepseek"]

    assert item["hint"] == "sk-a****bb44"
    # 掩码字面量不变（写回语义依赖它）。
    assert item["masked"] == API_KEY_MASK == "********"
    assert DEEPSEEK_KEY not in str(item)


def test_short_key_falls_back_to_the_plain_mask(client, db_session):
    save_search_config(db_session, SearchConfig(tavily_api_key=SHORT_KEY))

    item = _items(client)["web_search.tavily"]

    assert item["hint"] == API_KEY_MASK
    assert SHORT_KEY not in str(item)


def test_embedding_gets_a_hint_while_masked_stays_empty(client):
    """语义检索的配置卡只回布尔，但用户同样需要认得出"是哪一把"。"""
    from app.services.global_settings import mutate_state
    from app.services.llm import embedding_profiles_store

    saved = embedding_profiles_store.save_profile(
        name="公司向量",
        config={
            "base_url": "https://emb.example/v1",
            "model": "mock-embed",
            "api_key": "sk-embedding-1234567890",
        },
    )
    mutate_state(
        lambda state: state["embedding_profiles"].__setitem__("active_profile_id", saved["id"])
    )

    item = _items(client)["embedding.default"]

    assert item["hint"] == "sk-e****7890"
    # 历史口径：语义检索连掩码都不回（只回 boolean）。
    assert item["masked"] == ""
    assert item["key_configured"] is True


def test_copy_endpoint_writes_the_real_key_without_echoing_it(client, db_session, monkeypatch):
    from app.services import clipboard

    written: list[str] = []
    monkeypatch.setattr(clipboard, "write_text", lambda value: written.append(value))
    save_search_config(db_session, SearchConfig(deepseek_api_key=DEEPSEEK_KEY))

    response = client.post("/api/connections/web_search.deepseek/clipboard")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert written == [DEEPSEEK_KEY]
    assert DEEPSEEK_KEY not in response.text


def test_copy_endpoint_supports_a_specific_profile(client, monkeypatch):
    from app.services import clipboard
    from app.services.asr_profiles import list_asr_profiles

    written: list[str] = []
    monkeypatch.setattr(clipboard, "write_text", lambda value: written.append(value))
    state = save_asr_profile(
        AsrProfileIn(
            name="第二套语音",
            base_url="https://asr.example/v1",
            model="whisper-1",
            api_key="sk-asr-second-0987654321",
        )
    )
    profile_id = list_asr_profiles().profiles[-1].id

    response = client.post(f"/api/connections/asr.default/clipboard?profile_id={profile_id}")

    assert response.status_code == 200
    assert written == ["sk-asr-second-0987654321"]
    # 只复制那一条，生效项没有被顺手改掉。
    assert state.active_profile_id in ("", None)


def test_copy_never_logs_the_secret(client, db_session, monkeypatch, caplog):
    """复制路径一行日志都不能带明文：日志是"写出去就很难收回"的泄漏面。

    ``clipboard`` 模块本身不记日志，但一次复制会穿过凭据状态、搜索配置解析与 HTTP 层；
    这里开 DEBUG 全收，任何一层顺手 ``logger.debug(key)`` 都会让断言变红。
    """
    import logging

    from app.services import clipboard

    monkeypatch.setattr(clipboard, "write_text", lambda value: None)
    save_search_config(db_session, SearchConfig(deepseek_api_key=DEEPSEEK_KEY))

    with caplog.at_level(logging.DEBUG):
        response = client.post("/api/connections/web_search.deepseek/clipboard")

    assert response.status_code == 200
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert DEEPSEEK_KEY not in logged
    # 尾号也不许出现：排障时最容易被"只打后四位"骗过去。
    assert "bb44" not in logged


def test_copy_rejects_unknown_sources(client):
    response = client.post("/api/connections/nope.nope/clipboard")
    assert response.status_code == 404


def test_copy_reports_unconfigured_sources_without_crashing(client):
    response = client.post("/api/connections/web_search.jina/clipboard")
    assert response.status_code == 409


def test_system_sources_are_not_copyable_through_this_endpoint(client):
    """C 组不是密钥：抄它们的值请走前端本地复制，不经后端读明文。"""
    response = client.post("/api/connections/system.browser_port/clipboard")
    assert response.status_code == 404


def test_mask_value_is_untouched():
    """hint 是**加在掩码之外**的一层：掩码本身的口径一个字节都没变。"""
    assert mask_value(DEEPSEEK_KEY) == API_KEY_MASK
    assert mask_value("") == ""
    assert net_settings.split_credentials("http://u:p@127.0.0.1:7890")[0] == (
        "http://127.0.0.1:7890"
    )


@pytest.fixture(autouse=True)
def _engine_ready():
    assert engine is not None
