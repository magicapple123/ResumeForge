# SPDX-License-Identifier: Apache-2.0
"""「外部连接」页（T11 / T12）的定向用例。

只挂 `app.api.connections.router` 建一个最小 app：本模块的契约是"一次给齐三组快照"，
把它挂进整站会让失败信息指向无关的启动逻辑。数据库会话用 `db_session` 覆盖，不起
8005、不写真实库（`conftest` 已经把 DATA_DIR 与 global_settings.json 都隔离到测试目录）。

覆盖口径（对齐验收表的「外部连接页 A/B」「外部连接页 C」两行）：

1. 三态（已保存 / 未配置 / 仅本次会话）与存储方式标注都出现，且**真实密钥不出现在响应里**；
2. C 组四项可改、可恢复默认，非法值被拒且给出可操作原因；
3. 改完之后**消费者读到的是新值**（浏览器端口 → CDP 连接串里的端口；字体/更新源 → 拼出来的
   地址），这是"改完能观察到行为变化"的证据；
4. 备份载荷带上 C 组，导入时能恢复。
"""

from __future__ import annotations

import pytest
from app.api import connections as connections_api
from app.database import get_db
from app.schemas.setting import SearchConfig
from app.services import system_sources
from app.services.api_key_session import clear_session_key, set_session_key
from app.services.apply._site_browser import _browser_cache_key
from app.services.credentials import storage_protection
from app.services.data_backup import global_config
from app.services.data_backup.global_config import (
    build_global_llm_payload,
    restore_global_system_sources,
)
from app.services.rag import rag_model_download
from app.services.resume_font_builtin import _font_base_url
from app.services.update_check import DEFAULT_REPOSITORY, repository
from app.services.web_search_settings import save_search_config
from fastapi import FastAPI
from fastapi.testclient import TestClient

REAL_SEARCH_KEY = "sk-connections-test-deepseek-0123456789"


@pytest.fixture
def connections_client(db_session):
    """只挂本模块 router 的最小 app；`get_db` 覆盖成同一个会话。"""
    app = FastAPI()
    app.include_router(connections_api.router)

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _no_session_key():
    """会话密钥是进程级内存：每个用例前后都清掉，别让前一个用例漏给后一个。"""
    clear_session_key()
    yield
    clear_session_key()


def _items(payload: dict) -> dict[str, dict]:
    return {item["id"]: item for group in payload["groups"] for item in group["items"]}


def _system_item(payload: dict, item_id: str) -> dict:
    return _items(payload)[item_id]


# ===== A/B 组：三态与存储方式 =====


def test_get_connections_reports_three_groups_in_declared_order(connections_client, db_session):
    payload = connections_client.get("/api/connections").json()
    assert [group["id"] for group in payload["groups"]] == ["ai", "search", "system"]
    assert [group["kind"] for group in payload["groups"]] == [
        "credential",
        "credential",
        "system",
    ]
    # A 组是 AI 服务（大模型 / 语音转写 / 语义检索 / 仅会话），B 组是联网搜索三把 Key。
    assert {item["id"] for item in payload["groups"][0]["items"]} == {
        "llm.default",
        "llm.session",
        "asr.default",
        "embedding.default",
    }
    assert {item["id"] for item in payload["groups"][1]["items"]} == {
        "web_search.deepseek",
        "web_search.tavily",
        "web_search.jina",
    }
    assert payload["retrieved"] is True


def test_three_states_and_storage_labels(connections_client, db_session):
    """已保存 / 未配置 / 仅本次会话各举一例，并逐一给出存储方式标注。"""
    save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key=REAL_SEARCH_KEY)
    )
    set_session_key("sk-session-only-key")

    payload = connections_client.get("/api/connections").json()
    items = _items(payload)

    saved = items["web_search.deepseek"]
    assert saved["status"] == "saved"
    assert saved["status_label"] == "已保存"
    assert saved["key_configured"] is True
    # 掩码只说明"配了"，不回真值——响应全文里也找不到真实 Key。
    assert saved["masked"].startswith("********")
    assert REAL_SEARCH_KEY not in str(payload)

    missing = items["embedding.default"]
    assert missing["status"] == "not_configured"
    assert missing["status_label"] == "未配置"
    # 语义检索连掩码都不给（display=BOOLEAN 的既有口径）。
    assert missing["masked"] == ""
    assert missing["key_configured"] is False

    session_only = items["llm.session"]
    assert session_only["status"] == "session_only"
    assert session_only["status_label"] == "仅本次会话"
    assert session_only["protection"] == "memory_only"
    assert session_only["protection_label"] == "仅内存，不落盘"

    # 落盘来源的存储标注必须与平台一致：Windows 是 DPAPI，其它平台如实说明"无系统加密"。
    expected = storage_protection("web_search.deepseek")
    assert saved["protection"] == expected.value
    assert saved["protection_label"] in {"DPAPI 加密", "当前平台无系统加密"}
    assert payload["storage"]["kind"] == storage_protection(None).value


def test_read_only_sources_say_where_to_configure_them(connections_client, db_session):
    items = _items(connections_client.get("/api/connections").json())
    # 语义检索的 Key 只能在自己的配置卡里改：这里给出处，不假装可编辑。
    assert items["embedding.default"]["editable"] is False
    assert "语义检索" in items["embedding.default"]["write_hint"]
    # 还没有全局模型配置时，大模型这一条不给就地编辑（否则会写回一份空的服务商配置）。
    assert items["llm.default"]["editable"] is False
    assert "AI 模型" in items["llm.default"]["write_hint"]
    # 联网搜索三把 Key 与"仅本次会话"永远可以在本页改。
    assert items["web_search.tavily"]["editable"] is True
    assert items["llm.session"]["editable"] is True


# ===== C 组：四项可编辑 =====


def test_system_items_expose_value_and_default(connections_client):
    payload = connections_client.get("/api/connections").json()
    port = _system_item(payload, system_sources.ITEM_BROWSER_PORT)
    assert port["kind"] == "system"
    assert port["status"] == "default"
    assert port["status_label"] == "默认值"
    assert port["editable"] is True
    assert port["value"] == port["default_value"]
    # 这四项不是密钥：不借用 DPAPI 口径，也不出现在"三态"里。
    assert port["protection"] == "config_file"
    assert port["protection_label"] == "明文配置文件"
    assert {item["id"] for item in payload["groups"][2]["items"]} == set(
        system_sources.source_ids()
    )


def test_put_system_source_updates_browser_port_and_connection_key(connections_client, db_session):
    """改端口之后，浏览器引擎算出来的端口（CDP 连接串里的那一段）跟着变。"""
    before = _browser_cache_key(_apply_config())
    assert before[0] == 9333

    response = connections_client.put(
        f"/api/connections/system/{system_sources.ITEM_BROWSER_PORT}",
        json={"value": "9400"},
    )
    assert response.status_code == 200
    item = _system_item(response.json(), system_sources.ITEM_BROWSER_PORT)
    assert item["value"] == "9400"
    assert item["is_default"] is False
    assert item["status"] == "modified"

    after = _browser_cache_key(_apply_config())
    assert after[0] == 9400
    assert after[0] != before[0]

    # 恢复默认 = DELETE，端口回到出厂值。
    reset = connections_client.delete(f"/api/connections/system/{system_sources.ITEM_BROWSER_PORT}")
    assert reset.status_code == 200
    assert _system_item(reset.json(), system_sources.ITEM_BROWSER_PORT)["is_default"] is True
    assert _browser_cache_key(_apply_config())[0] == 9333


def test_font_and_update_sources_follow_the_setting(connections_client, monkeypatch):
    monkeypatch.delenv("RESUMEFORGE_UPDATE_REPO", raising=False)
    assert repository() == DEFAULT_REPOSITORY
    assert _font_base_url().startswith("https://mirrors.")

    connections_client.put(
        f"/api/connections/system/{system_sources.ITEM_UPDATE_REPO}",
        json={"value": "acme/ResumeForge"},
    )
    connections_client.put(
        f"/api/connections/system/{system_sources.ITEM_FONT_BASE_URL}",
        json={"value": "https://mirror.example.com/fonts"},
    )

    assert repository() == "acme/ResumeForge"
    # 字体下载 URL 是用这个根地址拼出来的：换源之后拼出来的地址也跟着换。
    expected = "https://mirror.example.com/fonts/" + "SourceHanSansSC-Regular.otf"
    assert _font_base_url() + "SourceHanSansSC-Regular.otf" == expected


def test_rag_asset_base_url_reaches_the_download_plan(connections_client, monkeypatch):
    """RAG 资产的下载计划用设置里的根地址拼 URL（这里把清单换成假值，只验拼接）。"""

    def fake_select_assets():
        return {
            "variant": "multilingual",
            "ort_version": "1.20.0",
            "model": {"file": "model.zip", "bytes": 10, "sha256": "x" * 64, "files": []},
            "runtime": {"file": "runtime.zip", "bytes": 10, "sha256": "y" * 64},
        }

    monkeypatch.setattr(rag_model_download, "select_assets", fake_select_assets)
    before = rag_model_download._plan()
    assert before[0]["sources"][0]["url"].startswith(
        "https://github.com/magicapple123/ResumeForge/releases/download/rag-assets-v1/"
    )

    connections_client.put(
        f"/api/connections/system/{system_sources.ITEM_RAG_ASSET_BASE_URL}",
        json={"value": "https://assets.example.com/rag-v1"},
    )
    after = rag_model_download._plan()
    assert after[0]["sources"][0]["url"] == "https://assets.example.com/rag-v1/model.zip"


@pytest.mark.parametrize(
    ("item_id", "value", "expected"),
    [
        (system_sources.ITEM_BROWSER_PORT, "80", "端口要在 1024–65535 之间"),
        (system_sources.ITEM_BROWSER_PORT, "abc", "端口必须是整数"),
        (system_sources.ITEM_FONT_BASE_URL, "ftp://mirror.example.com", "http:// 或 https://"),
        (system_sources.ITEM_RAG_ASSET_BASE_URL, "", "地址不能为空"),
        (system_sources.ITEM_UPDATE_REPO, "just-a-name", "owner/repo"),
    ],
)
def test_invalid_system_values_are_rejected(connections_client, item_id, value, expected):
    response = connections_client.put(f"/api/connections/system/{item_id}", json={"value": value})
    assert response.status_code == 400
    # 错误文案必须给出"怎么改"，不是一句"参数错误"。
    assert expected in response.json()["detail"]


def test_unknown_system_item_is_404(connections_client):
    assert (
        connections_client.put(
            "/api/connections/system/system.nope", json={"value": "1"}
        ).status_code
        == 404
    )
    assert connections_client.delete("/api/connections/system/system.nope").status_code == 404


# ===== 备份路径 =====


def test_backup_payload_carries_system_sources_and_restores_them():
    system_sources.set_value(system_sources.ITEM_BROWSER_PORT, "9401")
    system_sources.set_value(system_sources.ITEM_FONT_BASE_URL, "https://mirror.example.com/f/")

    payload = build_global_llm_payload(include_api_keys=False)
    assert payload is not None
    assert payload["system_sources"] == {
        "browser_port": "9401",
        "font_base_url": "https://mirror.example.com/f/",
    }
    assert global_config.payload_summary(payload)["system_sources"] == 2

    # 换台机器 / 改坏了之后从包里恢复。
    system_sources.reset_value(system_sources.ITEM_BROWSER_PORT)
    system_sources.reset_value(system_sources.ITEM_FONT_BASE_URL)
    assert restore_global_system_sources(payload) == 2
    assert system_sources.get_value(system_sources.ITEM_BROWSER_PORT) == "9401"
    assert (
        system_sources.get_value(system_sources.ITEM_FONT_BASE_URL)
        == "https://mirror.example.com/f/"
    )


def test_old_payload_without_system_sources_is_tolerated():
    # 载荷版本 1 的包里没有这个字段：返回 0，而不是把整次导入判成失败。
    assert restore_global_system_sources({"profiles": []}) == 0
    assert restore_global_system_sources(None) == 0
    # 未知键与非法值只跳过，不影响其它项。
    assert restore_global_system_sources({"system_sources": {"nope": "1"}}) == 0
    assert restore_global_system_sources({"system_sources": {"browser_port": "-1"}}) == 0


def _apply_config():
    """投递配置的出厂形态（端口用它自己的默认值，等于 config.DEFAULT_BROWSER_PORT）。"""
    from app.schemas.apply import ApplyConfigIn

    return ApplyConfigIn()
