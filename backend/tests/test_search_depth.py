# SPDX-License-Identifier: Apache-2.0
"""P4-08：三档搜索深度（snippet / standard / deep）+ Bing RSS 0 条提示。

旧设置项叫「抓取正文的条数」（0~3），语义是"抓前 N 条"。新口径是**深度档位**：
摘要 0 页 / 标准 2 页×2 段（1800 字符）/ 深入 5 页×3 段（4000 字符）。
旧的 ``fetch_pages`` 只保留只读兼容（0→snippet、1–2→standard、3→deep），保存只写
``depth``。这里钉住映射、真实请求页数与字符预算、工具 schema，以及"RSS 解析到 0 条"
不复用"这次没搜到"那句话。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant.assistant_web_search import (
    BING_RSS_EMPTY_MESSAGE,
    AssistantSearchError,
    search_web,
)
from app.services.assistant_tools._registry import tool_definitions
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import DEPTH_PROFILE, aggregate_search


def _result(index: int) -> dict[str, str]:
    return {
        "title": f"后端工程师招聘 {index}",
        "url": f"https://careers.example.com/jobs/{index}",
        "snippet": "后端招聘岗位说明",
    }


@pytest.mark.parametrize(
    ("legacy", "depth"),
    [(0, "snippet"), (1, "standard"), (2, "standard"), (3, "deep")],
)
def test_legacy_fetch_pages_maps_to_depth(legacy: int, depth: str):
    assert SearchConfig(fetch_pages=legacy).depth == depth


def test_depth_wins_over_legacy_value_when_both_are_given():
    assert SearchConfig(depth="deep", fetch_pages=0).depth == "deep"
    # `fetch_pages` 回填按档位折算（旧前端读到 3 = 深入，不会把深度降回摘要）。
    assert SearchConfig(depth="deep").fetch_pages == 3


def test_depth_profiles():
    assert DEPTH_PROFILE["snippet"] == (0, 0, 0)
    assert DEPTH_PROFILE["standard"] == (2, 2, 1800)
    assert DEPTH_PROFILE["deep"] == (5, 3, 4000)
    assert SearchConfig(depth="deep").page_budget == 5


@pytest.mark.asyncio
async def test_each_depth_fetches_the_documented_number_of_pages(monkeypatch):
    pages = {depth: [] for depth in ("snippet", "standard", "deep")}
    current = {"depth": "snippet"}

    async def fake_bing(_query: str):
        return [_result(index) for index in range(1, 8)]

    async def fake_fetch(url: str, max_chars: int = 0, **_kwargs):
        pages[current["depth"]].append(url)
        # 每页内容不同：跨页按指纹去重会把相同正文的第二页丢掉。
        return f"后端招聘岗位职责（{url}）：负责服务端开发与维护。"

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_fetch)

    limits: dict[str, int] = {}
    for depth in ("snippet", "standard", "deep"):
        current["depth"] = depth
        results = await aggregate_search(
            f"后端 招聘 {depth}", SearchConfig(sources=["bing"], depth=depth)
        )
        limits[depth] = sum(len(str(item.get("text") or "")) for item in results)

    assert len(pages["snippet"]) == 0  # 摘要档一页都不抓
    assert len(pages["standard"]) == 2
    assert len(pages["deep"]) == 5
    # 字符预算也落在档位里（标准 1800 / 深入 4000 是上限）。
    assert limits["snippet"] == 0
    assert 0 < limits["standard"] <= 1800
    assert limits["standard"] < limits["deep"] <= 4000


@pytest.mark.asyncio
async def test_tool_level_depth_overrides_the_setting(monkeypatch):
    fetched: list[str] = []

    async def fake_bing(_query: str):
        return [_result(index) for index in range(1, 4)]

    async def fake_fetch(url: str, max_chars: int = 0, **_kwargs):
        fetched.append(url)
        return f"后端招聘岗位职责（{url}）"

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_fetch)

    await aggregate_search(
        "后端 招聘 工具档位",
        SearchConfig(sources=["bing"], depth="deep"),
        depth="snippet",
    )
    assert fetched == [], "工具传的 depth=snippet 必须压过设置页的 deep"


def test_tool_schema_exposes_the_three_depths():
    definitions = tool_definitions(web_search=True)
    search = next(item for item in definitions if item["function"]["name"] == "web_search")
    depth = search["function"]["parameters"]["properties"]["depth"]
    assert depth["enum"] == ["snippet", "standard", "deep"]
    assert search["function"]["parameters"]["required"] == ["query"]


@pytest.mark.asyncio
async def test_zero_rss_items_says_the_bing_endpoint_may_have_changed(monkeypatch):
    """RSS 解析到 0 条 ≠ 这次没搜到：必须提示端点可能已变更（不是让用户换关键词）。"""

    async def empty_rss(_query: str) -> bytes:
        return b"<rss><channel></channel></rss>"

    monkeypatch.setattr("app.services.assistant.assistant_web_search.fetch_bing_rss", empty_rss)
    with pytest.raises(AssistantSearchError) as excinfo:
        await search_web("后端 招聘")
    assert "Bing RSS 可能已变更" in excinfo.value.public_message


@pytest.mark.asyncio
async def test_aggregate_surfaces_the_bing_hint_instead_of_the_generic_message(monkeypatch):
    async def empty_bing(_query: str):
        raise AssistantSearchError(BING_RSS_EMPTY_MESSAGE)

    monkeypatch.setattr(aggregate_module, "bing_search", empty_bing)
    with pytest.raises(AssistantSearchError) as excinfo:
        await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="snippet"))
    assert "Bing RSS 可能已变更" in excinfo.value.public_message
