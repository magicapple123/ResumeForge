# SPDX-License-Identifier: Apache-2.0
"""P4-09：Tavily 来源。

五条 mock 路径（200 / 401 / 429 / 空结果 / 坏 JSON）用 ``httpx.MockTransport`` 跑，
不打真网。另钉住：

- ``content`` → ``snippet``、``raw_content`` → ``text``，且 ``text`` 必须过 P4-07 的选段
  （否则"Tavily 给整页、本地给选段"，模型读到的上下文质量会分成两种）；
- 未配 Key 时该源**不出现在可用列表**里（``configured_sources``）；
- Key 登记在备份剥离名单里（2.1.0 修过"勾了不含 API Key 仍带出 key"的洞）。
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing

import httpx
import pytest
from app.schemas.setting import SearchConfig
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.providers.tavily import TAVILY_ENDPOINT, TavilyResults, search_tavily


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _payload(*, raw: str = "") -> dict:
    return {
        "results": [
            {
                "title": "后端工程师招聘",
                "url": "https://careers.example.com/jobs/1",
                "content": "后端招聘岗位摘要",
                "raw_content": raw,
                "published_date": "2025-11-02",
            }
        ]
    }


@pytest.mark.asyncio
async def test_200_returns_normalized_results():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=_payload(raw="整页正文" * 50))

    results = await search_tavily(
        "后端 招聘",
        api_key="tvly-test",
        depth="deep",
        transport=_transport(handler),
    )

    assert seen["url"] == TAVILY_ENDPOINT
    assert seen["auth"] == "Bearer tvly-test"
    assert seen["body"]["search_depth"] == "advanced"  # deep → advanced
    assert seen["body"]["include_raw_content"] is True
    assert isinstance(results, TavilyResults)
    assert results.failure is None
    assert results[0]["snippet"] == "后端招聘岗位摘要"
    assert results[0]["text"].startswith("整页正文")
    assert results[0]["published_at"] == "2025-11-02"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "failure"),
    [(401, "unauthorized"), (403, "unauthorized"), (429, "rate_limited"), (500, "rate_limited")],
)
async def test_http_failures_are_classified(status: int, failure: str):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"detail": "nope"})

    results = await search_tavily("后端 招聘", api_key="tvly-test", transport=_transport(handler))
    assert list(results) == []
    assert results.failure == failure


@pytest.mark.asyncio
async def test_empty_results_is_success_with_no_items():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    results = await search_tavily("后端 招聘", api_key="tvly-test", transport=_transport(handler))
    assert list(results) == []
    assert results.failure is None  # "没有结果"不是失败，不该标成 config/rate


@pytest.mark.asyncio
async def test_bad_json_is_a_parse_failure():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>maintenance</html>")

    results = await search_tavily("后端 招聘", api_key="tvly-test", transport=_transport(handler))
    assert results.failure == "bad_json"


@pytest.mark.asyncio
async def test_missing_key_does_not_hit_the_network():
    called: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        called.append(1)
        return httpx.Response(200, json=_payload())

    results = await search_tavily("后端 招聘", api_key="", transport=_transport(handler))
    assert results.failure == "missing_key"
    assert called == []


def test_source_is_unavailable_without_a_key():
    assert SearchConfig(sources=["tavily", "bing"]).configured_sources() == ["bing"]
    assert SearchConfig(sources=["tavily"], tavily_api_key="tvly-x").configured_sources() == [
        "tavily"
    ]


@pytest.mark.asyncio
async def test_raw_content_goes_through_the_passage_selector(monkeypatch):
    """``raw_content`` 是整页正文：必须选段，而不是原样塞进上下文。"""
    long_body = ("导航 首页 关于我们 客户案例 " * 60) + (
        "后端工程师招聘：负责服务端接口设计，本次招聘 5 人。"
    )

    async def fake_tavily(_query: str, **_kwargs):
        return TavilyResults(
            [
                {
                    "title": "后端工程师招聘",
                    "url": "https://careers.example.com/jobs/1",
                    "snippet": "岗位摘要",
                    "text": long_body,
                }
            ]
        )

    async def ok_bing(_query: str):
        return []

    monkeypatch.setattr(aggregate_module, "search_tavily", fake_tavily)
    monkeypatch.setattr(aggregate_module, "bing_search", ok_bing)

    results = await aggregate_search(
        "后端 招聘",
        SearchConfig(sources=["tavily"], tavily_api_key="tvly-test", depth="standard"),
    )
    text = results[0]["text"]
    assert "后端工程师招聘：负责服务端接口设计" in text
    assert len(text) < len(long_body)  # 确实被选段/截断过，不是整页
    assert results[0]["passages"]


def test_tavily_key_is_registered_in_the_backup_strip_list(tmp_path):
    """新 Key 必须登记进备份剥离名单，否则"不含密钥"的勾选对它无效。"""
    from app.services.data_backup.api_keys import (
        _SECRET_APP_SETTING_WHERE,
        _plaintext_api_keys_in,
        _strip_api_keys,
    )

    assert "search_tavily_api_key" in _SECRET_APP_SETTING_WHERE

    database = tmp_path / "backup-copy.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT)")
        connection.execute(
            "INSERT INTO app_setting (key, value) VALUES ('search_tavily_api_key', 'tvly-plaintext-123')"
        )
        connection.execute(
            "INSERT INTO app_setting (key, value) VALUES ('search_jina_api_key', 'jina-plaintext-456')"
        )
        connection.commit()

    assert sorted(_plaintext_api_keys_in(database)) == ["jina-plaintext-456", "tvly-plaintext-123"]
    _strip_api_keys(database)
    assert _plaintext_api_keys_in(database) == []
