# SPDX-License-Identifier: Apache-2.0
"""「每次最多返回的结果条数」与模型可选 ``limit``（清单 §5）的离线测试。

钉住三件事：

1. ``max_results`` 是上限而不是精确值：schema 允许 1–50，聚合层按上限截断；
2. 模型传 ``limit`` 时本次按它取（不能超过上限、不能小于 1），不传按上限；
3. 每个来源的取数上限随 cap 放大，但 Bing 自己只有 8 条（如实，不假装 50）；
4. 工具 handler 的非法 ``limit`` 按"没传"处理，描述里写明设置页给的上限。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant_tools._registry import tool_definitions
from app.services.assistant_tools._types import (
    _WEB_SEARCH_DESC_SUMMARIES,
    _WEB_SEARCH_DESC_WITH_PAGES,
    web_search_description,
)
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search


def _result(index: int, *, host: str = "careers.example.com") -> dict[str, str]:
    return {
        "title": f"后端工程师招聘 {index}",
        "url": f"https://{host}/jobs/{index}",
        "snippet": "后端 招聘 岗位说明",
    }


def _many(count: int, *, host: str = "careers.example.com") -> list[dict[str, str]]:
    return [_result(index, host=host) for index in range(1, count + 1)]


# ===== schema 边界 =====


def test_search_config_allows_up_to_fifty_results():
    assert SearchConfig(max_results=1).max_results == 1
    assert SearchConfig(max_results=50).max_results == 50
    assert SearchConfig().max_results == 8
    for invalid in (0, 51, -1):
        with pytest.raises(ValueError):
            SearchConfig(max_results=invalid)


# ===== 聚合层的 cap 语义 =====


@pytest.mark.asyncio
async def test_limit_caps_this_call_below_the_configured_maximum(monkeypatch):
    async def fake_bing(_query: str):
        return _many(6)

    async def fake_ddg(_query: str, limit: int = 10):
        return _many(6, host="jobs.example.com")

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "duckduckgo"], max_results=8), limit=3
    )
    assert len(results) == 3


@pytest.mark.asyncio
async def test_limit_above_the_configured_maximum_is_clamped(monkeypatch):
    async def fake_bing(_query: str):
        return _many(15)

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing"], max_results=10), limit=999
    )
    assert len(results) == 10


@pytest.mark.asyncio
async def test_limit_below_one_is_clamped_to_one(monkeypatch):
    async def fake_bing(_query: str):
        return _many(4)

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing"], max_results=8), limit=0
    )
    assert len(results) == 1


@pytest.mark.asyncio
async def test_without_limit_behaves_like_the_old_max_results(monkeypatch):
    async def fake_bing(_query: str):
        return _many(12)

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], max_results=5))
    assert len(results) == 5


@pytest.mark.asyncio
async def test_per_source_limit_grows_with_the_cap(monkeypatch):
    captured: dict[str, int] = {}

    async def fake_ddg(_query: str, limit: int = 10):
        captured["ddg"] = limit
        return [_result(1)]

    async def fake_searxng(_query: str, _base_url: str, limit: int = 10):
        captured["searxng"] = limit
        return []

    async def fake_deepseek(_query, count=10, need_content=False, ori_question="", *, api_key=""):
        from app.services.search.deepseek import DeepSeekResults

        captured["deepseek"] = count
        return DeepSeekResults()

    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)
    monkeypatch.setattr(aggregate_module, "search_searxng", fake_searxng)
    monkeypatch.setattr(aggregate_module, "search_deepseek", fake_deepseek)

    await aggregate_search(
        "后端 招聘",
        SearchConfig(
            sources=["duckduckgo", "searxng", "deepseek"],
            searxng_url="http://localhost:8080",
            deepseek_api_key="sk-test",
            max_results=30,
        ),
    )
    # 设置上限 30 → 每个来源都多取一些候选，否则合并去重后拿不满。
    assert captured == {"ddg": 30, "searxng": 30, "deepseek": 30}

    captured.clear()
    await aggregate_search(
        "后端 招聘",
        SearchConfig(
            sources=["duckduckgo", "searxng", "deepseek"],
            searxng_url="http://localhost:8080",
            deepseek_api_key="sk-test",
            max_results=8,
        ),
    )
    # 默认上限 8 时维持原来的 10 条候选（不能比改动前更少）。
    assert captured == {"ddg": 10, "searxng": 10, "deepseek": 10}


@pytest.mark.asyncio
async def test_bing_only_still_caps_at_eight_even_with_max_50(monkeypatch):
    """Bing 的单来源上限是 8；设 50 也不能假装能拿 50 条。"""
    import app.services.assistant.assistant_web_search as web_search_module

    items = "".join(
        f"<item><title>后端工程师招聘 {index}</title>"
        f"<link>https://careers.example.com/jobs/{index}</link>"
        "<description>招聘岗位说明</description></item>"
        for index in range(1, 16)
    )
    rss = f"<rss><channel>{items}</channel></rss>".encode()

    async def fake_fetch_rss(_query: str) -> bytes:
        return rss

    monkeypatch.setattr(aggregate_module, "bing_search", web_search_module.search_web)
    monkeypatch.setattr(web_search_module, "fetch_bing_rss", fake_fetch_rss)

    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], max_results=50))
    assert len(results) == 8


# ===== 工具协议：可选 limit =====


def test_tool_schema_has_an_optional_limit_and_only_query_is_required():
    definitions = tool_definitions(web_search=True)
    search = next(item for item in definitions if item["function"]["name"] == "web_search")
    parameters = search["function"]["parameters"]
    assert parameters["required"] == ["query"]
    limit = parameters["properties"]["limit"]
    assert limit["type"] == "integer"
    assert limit["minimum"] == 1
    assert limit["maximum"] == 50


def test_tool_description_mentions_the_configured_maximum():
    assert web_search_description(0) == _WEB_SEARCH_DESC_SUMMARIES
    assert web_search_description(2) == _WEB_SEARCH_DESC_WITH_PAGES
    # 没有上下文（导入预览等）时不写具体条数。
    assert "最多返回" not in web_search_description(0, 0)
    described = web_search_description(0, 12)
    assert described.startswith(_WEB_SEARCH_DESC_SUMMARIES)
    assert "最多返回 12 条" in described
    assert "limit" in described

    definitions = tool_definitions(web_search=True, fetch_pages=0, max_results=12)
    search = next(item for item in definitions if item["function"]["name"] == "web_search")
    assert "最多返回 12 条" in search["function"]["description"]


@pytest.mark.asyncio
async def test_tool_handler_passes_limit_and_ignores_invalid_values(db_session, monkeypatch):
    from app.services.assistant_tools.search_tools import _tool_web_search

    seen: list[int | None] = []

    async def fake_search(_query: str, _config, limit=None):
        seen.append(limit)
        return [
            {
                "title": "后端工程师招聘官网",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "招聘",
            }
        ]

    monkeypatch.setattr("app.services.search.aggregate_search", fake_search)

    await _tool_web_search(db_session, {"query": "后端 招聘", "limit": 3})
    await _tool_web_search(db_session, {"query": "后端 招聘"})
    # 解析失败按"没传"处理：不让一个格式错的可选参数把整次搜索打成异常。
    await _tool_web_search(db_session, {"query": "后端 招聘", "limit": "many"})
    await _tool_web_search(db_session, {"query": "后端 招聘", "limit": True})

    assert seen == [3, None, None, None]
