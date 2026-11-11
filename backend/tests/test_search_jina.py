# SPDX-License-Identifier: Apache-2.0
"""P4-10：Jina 来源 + 正文读取兜底。

两部分：

1. **搜索** ``GET https://s.jina.ai/<query>``：五条 mock 路径（200 / 401 / 429 / 空 / 坏
   JSON），只取前 5 条，解析成 ``[{title, url, snippet}]``；
2. **读取兜底** ``GET https://r.jina.ai/<url>``：接成 ``page_reader`` 的可选兜底，
   **只在本地抽取失败时触发**，且同一个地址只请求一次。
"""

from __future__ import annotations

import httpx
import pytest
from app.schemas.setting import SearchConfig
from app.services.search import aggregate as aggregate_module
from app.services.search import page_reader
from app.services.search.aggregate import aggregate_search
from app.services.search.page_reader import fetch_page_text
from app.services.search.providers.jina import (
    JinaResults,
    read_jina_page,
    search_jina,
)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _payload(count: int = 7) -> dict:
    return {
        "code": 200,
        "data": [
            {
                "title": f"后端工程师招聘 {index}",
                "url": f"https://careers.example.com/jobs/{index}",
                "description": "后端招聘岗位摘要",
                "content": "整页正文",
            }
            for index in range(1, count + 1)
        ],
    }


@pytest.mark.asyncio
async def test_200_parses_the_first_five_results():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json=_payload(7))

    results = await search_jina("后端 招聘", api_key="jina-test", transport=_transport(handler))

    assert isinstance(results, JinaResults)
    assert results.failure is None
    # 只取前 5 条：每条都带整页正文，再多会挤掉别的来源。
    assert len(results) == 5
    assert results[0] == {
        "title": "后端工程师招聘 1",
        "url": "https://careers.example.com/jobs/1",
        "snippet": "后端招聘岗位摘要",
        "text": "整页正文",
    }
    assert seen["auth"] == "Bearer jina-test"
    assert seen["url"].startswith("https://s.jina.ai/")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "failure"),
    [(401, "unauthorized"), (429, "rate_limited"), (503, "rate_limited")],
)
async def test_http_failures_are_classified(status: int, failure: str):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status)

    results = await search_jina("后端 招聘", api_key="jina-test", transport=_transport(handler))
    assert list(results) == []
    assert results.failure == failure


@pytest.mark.asyncio
async def test_empty_data_is_success_with_no_items():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 200, "data": []})

    results = await search_jina("后端 招聘", api_key="jina-test", transport=_transport(handler))
    assert list(results) == []
    assert results.failure is None


@pytest.mark.asyncio
async def test_bad_json_is_a_parse_failure():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json at all")

    results = await search_jina("后端 招聘", api_key="jina-test", transport=_transport(handler))
    assert results.failure == "bad_json"


def test_source_is_unavailable_without_a_key():
    assert SearchConfig(sources=["jina", "bing"]).configured_sources() == ["bing"]


@pytest.mark.asyncio
async def test_reader_returns_the_clean_content():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://r.jina.ai/https://careers.example.com/jobs/1"
        return httpx.Response(200, json={"data": {"content": "干净正文"}})

    text = await read_jina_page(
        "https://careers.example.com/jobs/1", api_key="jina-test", transport=_transport(handler)
    )
    assert text == "干净正文"


@pytest.mark.asyncio
async def test_reader_fails_closed_to_empty_string():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    assert (
        await read_jina_page(
            "https://careers.example.com/jobs/1",
            api_key="jina-test",
            transport=_transport(handler),
        )
        == ""
    )


@pytest.mark.asyncio
async def test_fallback_only_fires_when_local_extraction_returns_nothing(monkeypatch):
    calls: list[str] = []

    async def local_empty(_url: str, _max_chars: int, _transport):
        return ""

    async def local_ok(_url: str, _max_chars: int, _transport):
        return "本机抽到的正文"

    async def fallback(url: str, _max_chars: int) -> str:
        calls.append(url)
        return "Jina 兜底正文"

    monkeypatch.setattr(page_reader, "_fetch_local_text", local_empty)
    assert (
        await fetch_page_text("https://careers.example.com/1", reader_fallback=fallback)
        == "Jina 兜底正文"
    )
    assert calls == ["https://careers.example.com/1"]

    # 本地能抽出正文时**不调用兜底**（不重复请求同一地址）。
    calls.clear()
    monkeypatch.setattr(page_reader, "_fetch_local_text", local_ok)
    assert await fetch_page_text("https://careers.example.com/2", reader_fallback=fallback) == (
        "本机抽到的正文"
    )
    assert calls == []


@pytest.mark.asyncio
async def test_fallback_exception_is_swallowed(monkeypatch):
    async def local_empty(_url: str, _max_chars: int, _transport):
        return ""

    async def boom(_url: str, _max_chars: int) -> str:
        raise httpx.ConnectError("网络炸了")

    monkeypatch.setattr(page_reader, "_fetch_local_text", local_empty)
    assert await fetch_page_text("https://x.example.com/1", reader_fallback=boom) == ""


@pytest.mark.asyncio
async def test_aggregate_wires_the_fallback_only_when_a_jina_key_exists(monkeypatch):
    seen: list[bool] = []

    async def fake_bing(_query: str):
        return [
            {
                "title": "后端工程师招聘",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "后端招聘岗位摘要",
            }
        ]

    async def fake_fetch(_url: str, max_chars: int = 0, **kwargs):
        seen.append(kwargs.get("reader_fallback") is not None)
        return "后端招聘岗位职责：负责服务端开发。"

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_fetch)

    await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing"], depth="standard", jina_api_key="")
    )
    await aggregate_search(
        "后端 招聘 有key",
        SearchConfig(sources=["bing"], depth="standard", jina_api_key="jina-test"),
    )
    assert seen == [False, True]
