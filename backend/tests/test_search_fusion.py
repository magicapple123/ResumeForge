# SPDX-License-Identifier: Apache-2.0
"""P4-03：RRF 融合（``1/(k+rank)``，k=60）。

旧实现 ``_interleave`` 轮流取一条再按 ``official_like_score`` 重排，"同一结果被多个来源
命中"完全不加权。这里钉住：

1. 三源都命中的结果（排 1/3/5）必须排在"只有单源排第一"的结果之前；
2. 分数就是 ``Σ 1/(60+rank)``，定点化到 4 位（k 值固定，分数可断言）；
3. ``official_like_score`` 只做 tie-break：同分时官网在前，**不会**压过多源命中。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.fusion import DEFAULT_RRF_K, rrf_scores


def _result(title: str, url: str) -> dict[str, str]:
    return {"title": title, "url": url, "snippet": "后端招聘岗位说明"}


def test_rrf_scores_use_the_shared_k_and_rounding():
    """同一结果排 1/3/5 vs 只在单源排 1：分数按公式逐项可算。"""
    assert DEFAULT_RRF_K == 60
    scores = rrf_scores(
        {
            "bing": ["https://multi.example.com/9", "https://b.example.com/2"],
            "duckduckgo": [
                "https://c.example.com/3",
                "https://c.example.com/4",
                "https://multi.example.com/9",
            ],
            "searxng": [
                "https://x.example.com/5",
                "https://y.example.com/6",
                "https://z.example.com/7",
                "https://w.example.com/8",
                "https://multi.example.com/9",
            ],
        }
    )
    # 三源命中：rank 1 + 3 + 5。
    assert scores["https://multi.example.com/9"] == round(1 / 61 + 1 / 63 + 1 / 65, 4)
    # 单源第一名（只有 bing 认它，但排第一）。
    assert scores["https://b.example.com/2"] == round(1 / 62, 4)
    assert scores["https://multi.example.com/9"] > scores["https://b.example.com/2"]


@pytest.mark.asyncio
async def test_multi_source_hit_outranks_a_single_source_first_place(monkeypatch):
    """真实聚合路径：同一 URL 在三个来源里排 1/3/5，必须胜过单源排第一的那条。"""
    multi = "https://careers.example.com/jobs/9"

    async def fake_bing(_query: str):
        return [
            _result("后端招聘 multi 命中", multi),
            _result("后端招聘 b2", "https://b.example.com/2"),
        ]

    async def fake_ddg(_query: str, limit: int = 10):
        return [
            _result("后端招聘 d1", "https://d1.example.com/1"),
            _result("后端招聘 d2", "https://d2.example.com/2"),
            _result("后端招聘 multi 命中", multi),
        ]

    async def fake_searxng(_query: str, _base_url: str, limit: int = 10):
        return [
            _result("后端招聘 s1", "https://s1.example.com/1"),
            _result("后端招聘 s2", "https://s2.example.com/2"),
            _result("后端招聘 s3", "https://s3.example.com/3"),
            _result("后端招聘 s4", "https://s4.example.com/4"),
            _result("后端招聘 multi 命中", multi),
        ]

    async def rank_one_only(*_args, **_kwargs):
        from app.services.search.deepseek import DeepSeekResults

        # 只有一个来源认它，且排第一。
        return DeepSeekResults([_result("后端招聘 单源第一", "https://single.example.com/1")])

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)
    monkeypatch.setattr(aggregate_module, "search_searxng", fake_searxng)
    monkeypatch.setattr(aggregate_module, "search_deepseek", rank_one_only)

    results = await aggregate_search(
        "后端 招聘",
        SearchConfig(
            sources=["bing", "duckduckgo", "searxng", "deepseek"],
            searxng_url="http://localhost:8080",
            deepseek_api_key="sk-test",
            depth="snippet",
        ),
    )
    urls = [item["url"] for item in results]
    assert urls[0] == multi
    assert urls.index(multi) < urls.index("https://single.example.com/1")
    # 去重仍然生效：三源命中的那一条只出现一次。
    assert urls.count(multi) == 1


@pytest.mark.asyncio
async def test_official_like_score_only_breaks_ties(monkeypatch):
    """两个来源各命中一条同分结果时，官网排在第三方平台之前（只是 tie-break）。"""

    async def fake_bing(_query: str):
        return [_result("后端招聘 第三方岗位", "https://www.zhipin.com/job/1")]

    async def fake_ddg(_query: str, limit: int = 10):
        return [_result("后端招聘官网", "https://careers.example.com/jobs/1")]

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "duckduckgo"], depth="snippet")
    )
    assert [item["url"] for item in results] == [
        "https://careers.example.com/jobs/1",
        "https://www.zhipin.com/job/1",
    ]
