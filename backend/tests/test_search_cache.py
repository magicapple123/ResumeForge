# SPDX-License-Identifier: Apache-2.0
"""P4-05：搜索结果 TTL 缓存（进程内，5–10 分钟）。

DeepSeek 搜索按次计费，Bing/DDG 会被限流，而"同一句问话连问两次"在实际使用里很常见
（模型换措辞重试、用户点两次、一次回答里两个工具调用问了同一件事）。这里钉住：

1. 同一 query 连调两次 → 第二次 **0 次网络请求**（计数假 transport/假来源）；
2. 缓存键含 sources 与 depth：换了来源集合或档位必须换键（否则拿到另一套结果）；
3. 过期后重新请求（**注入时钟**推进，不 sleep）；
4. 只缓存成功结果：抛错的调用不写缓存。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant.assistant_web_search import AssistantSearchError
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.cache import (
    DEFAULT_TTL_SECONDS,
    SearchCache,
    cache_key,
    normalize_query,
)


def _result(url: str = "https://careers.example.com/jobs/1") -> dict[str, str]:
    return {"title": "后端工程师招聘官网", "url": url, "snippet": "后端招聘岗位说明"}


def test_ttl_is_in_the_five_to_ten_minute_window():
    assert 5 * 60 <= DEFAULT_TTL_SECONDS <= 10 * 60


def test_cache_key_normalizes_query_and_sorts_sources():
    assert normalize_query("  后端   招聘 ") == "后端 招聘"
    assert cache_key("后端 招聘", ["bing", "duckduckgo"], "standard") == cache_key(
        "后端  招聘", ["duckduckgo", "bing"], "standard"
    )
    # 来源集合、档位、条数上限不同 → 不同的键。
    assert cache_key("后端 招聘", ["bing"], "standard") != cache_key("后端 招聘", ["bing"], "deep")
    assert cache_key("后端 招聘", ["bing"], "standard", 3) != cache_key(
        "后端 招聘", ["bing"], "standard", 8
    )


def test_cache_expires_with_an_injected_clock():
    now = [1000.0]
    cache = SearchCache(ttl_seconds=60, clock=lambda: now[0])
    cache.set("k", {"value": 1})
    assert cache.get("k") == {"value": 1}
    now[0] += 59
    assert cache.get("k") == {"value": 1}
    now[0] += 2  # 越过 TTL
    assert cache.get("k") is None


def test_cache_returns_copies_so_callers_cannot_corrupt_it():
    cache = SearchCache()
    cache.set("k", [_result()])
    got = cache.get("k")
    got[0]["title"] = "被改过"
    assert cache.get("k")[0]["title"] == "后端工程师招聘官网"


@pytest.mark.asyncio
async def test_second_identical_search_makes_no_network_calls(monkeypatch):
    """同 query 连调两次：第二次 0 网络（来源函数一次都不再被调用）。"""
    calls: list[str] = []

    async def counting_bing(_query: str):
        calls.append("bing")
        return [_result()]

    monkeypatch.setattr(aggregate_module, "bing_search", counting_bing)
    config = SearchConfig(sources=["bing"], depth="snippet")

    first = await aggregate_search("后端 招聘", config)
    second = await aggregate_search("后端 招聘", config)

    assert calls == ["bing"], f"第二次仍在打网络：{calls}"
    assert first.cached is False
    assert second.cached is True
    assert [item["url"] for item in second] == [item["url"] for item in first]


@pytest.mark.asyncio
async def test_changing_the_sources_or_depth_misses_the_cache(monkeypatch):
    calls: list[str] = []

    async def counting_bing(_query: str):
        calls.append("bing")
        return [_result()]

    async def counting_ddg(_query: str, limit: int = 10):
        calls.append("ddg")
        return [_result("https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "bing_search", counting_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", counting_ddg)

    await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="snippet"))
    await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="deep"))
    await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "duckduckgo"], depth="snippet")
    )
    # 三次不同配置 → bing 被调 3 次、ddg 1 次。
    assert calls == ["bing", "bing", "bing", "ddg"]


@pytest.mark.asyncio
async def test_failures_are_not_cached(monkeypatch):
    attempts: list[int] = []

    async def flaky_bing(_query: str):
        attempts.append(1)
        if len(attempts) == 1:
            raise AssistantSearchError("联网搜索服务暂时不可用，请稍后重试")
        return [_result()]

    monkeypatch.setattr(aggregate_module, "bing_search", flaky_bing)
    config = SearchConfig(sources=["bing"], depth="snippet")

    with pytest.raises(AssistantSearchError):
        await aggregate_search("后端 招聘", config)
    # 失败没有被缓存：第二次会重新请求并成功。
    results = await aggregate_search("后端 招聘", config)
    assert len(attempts) == 2
    assert results.cached is False
