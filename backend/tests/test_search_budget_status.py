# SPDX-License-Identifier: Apache-2.0
"""P4-02：搜索总预算（6–8s）与 ``source_status`` 可见性。

旧实现 ``asyncio.gather(*tasks)`` 等最慢的那个源，而各源 read timeout 从 12s 到 30s
不等——一个源卡住，整次搜索就卡住。这里钉住四件事：

1. 总预算是硬上限：卡住的源被丢弃，**已完成的结果照常返回**；
2. ``source_status`` 每条只有 ``source/ok/elapsed_ms/error_kind`` 四个字段；
3. ``error_kind`` 只有 ``config``/``rate``/``network``/``parse`` 四种；
4. 五条失败路径（200 / 401 / 429 / 超时 / 坏 JSON）各自的分类。
"""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest
from app.schemas.setting import SearchConfig
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.status import ERROR_KINDS


def _result(title: str, url: str) -> dict[str, str]:
    return {"title": title, "url": url, "snippet": "后端招聘岗位说明"}


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://search.example.com/q")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError(f"HTTP {status}", request=request, response=response)


@pytest.mark.asyncio
async def test_a_hanging_source_is_dropped_and_the_rest_still_returns(monkeypatch):
    """一个源 hang 15 秒：整体按总预算返回，别的来源结果完整。"""
    assert 6.0 <= aggregate_module.SEARCH_BUDGET_SECONDS <= 8.0

    async def hanging_bing(_query: str):
        await asyncio.sleep(15)
        return [_result("不该出现", "https://slow.example.com/1")]

    async def fast_ddg(_query: str, limit: int = 10):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "bing_search", hanging_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fast_ddg)
    # 把预算缩到 1 秒：断言的是"预算生效"这条性质，不必真等 7 秒。
    monkeypatch.setattr(aggregate_module, "SEARCH_BUDGET_SECONDS", 1.0)

    started = time.perf_counter()
    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "duckduckgo"], depth="snippet")
    )
    elapsed = time.perf_counter() - started

    assert elapsed < 1.6, f"总预算没有生效，实际 {elapsed:.2f}s"
    assert [item["url"] for item in results] == ["https://careers.example.com/jobs/2"]

    status = {item["source"]: item for item in results.source_status}
    assert status["bing"]["ok"] is False
    assert status["bing"]["error_kind"] == "network"
    assert status["bing"]["elapsed_ms"] >= 900  # 记的是"等到预算耗尽"的时间
    assert status["duckduckgo"]["ok"] is True
    assert status["duckduckgo"]["error_kind"] == ""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raiser", "expected_kind"),
    [
        (lambda: _http_error(401), "config"),
        (lambda: _http_error(429), "rate"),
        (lambda: TimeoutError(), "network"),
        (lambda: ValueError("Expecting value: line 1 column 1"), "parse"),
    ],
)
async def test_failure_paths_are_classified_into_four_kinds(monkeypatch, raiser, expected_kind):
    async def broken_ddg(_query: str, limit: int = 10):
        raise raiser()

    async def ok_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "search_duckduckgo", broken_ddg)
    monkeypatch.setattr(aggregate_module, "bing_search", ok_bing)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "duckduckgo"], depth="snippet")
    )
    status = {item["source"]: item for item in results.source_status}
    assert status["duckduckgo"]["ok"] is False
    assert status["duckduckgo"]["error_kind"] == expected_kind
    assert status["duckduckgo"]["error_kind"] in ERROR_KINDS
    # 200 那条路径：成功、无 error_kind、耗时是真实测出来的。
    assert status["bing"] == {
        "source": "bing",
        "ok": True,
        "elapsed_ms": status["bing"]["elapsed_ms"],
        "error_kind": "",
    }


@pytest.mark.asyncio
async def test_status_entries_have_exactly_the_documented_fields(monkeypatch):
    async def ok_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "bing_search", ok_bing)
    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="snippet"))
    assert results.source_status
    for entry in results.source_status:
        assert set(entry) == {"source", "ok", "elapsed_ms", "error_kind"}
        assert isinstance(entry["elapsed_ms"], int)


@pytest.mark.asyncio
async def test_provider_level_failures_are_mapped_too(monkeypatch):
    """DeepSeek/Tavily/Jina 用 ``.failure`` 报告失败（不是抛异常），也要分类。"""
    from app.services.search.providers.tavily import TavilyResults

    async def ok_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    async def rate_limited_tavily(*_args, **_kwargs):
        return TavilyResults(failure="rate_limited")

    monkeypatch.setattr(aggregate_module, "bing_search", ok_bing)
    monkeypatch.setattr(aggregate_module, "search_tavily", rate_limited_tavily)

    results = await aggregate_search(
        "后端 招聘",
        SearchConfig(sources=["bing", "tavily"], tavily_api_key="tvly-test", depth="snippet"),
    )
    status = {item["source"]: item for item in results.source_status}
    assert status["tavily"]["ok"] is False
    assert status["tavily"]["error_kind"] == "rate"
