# SPDX-License-Identifier: Apache-2.0
"""P4-04：发布时间透传（"不要引入过时东西"）。

旧链路把 Bing RSS 的 ``pubDate`` 整条丢掉，于是 2021 年的招聘公告和上周的岗位在模型
眼里一模一样。这里钉住：

1. RSS 的 ``pubDate`` → ``published_at``（ISO）；
2. 上下文首行标日期（``[来源1] 2025-11-02 · 标题``），解析不出来标「日期未知」；
3. 带「最新」这类时效词的查询把 12 个月内的结果排前，**但不丢弃**旧结果；
4. 阈值：12 个月内加分、超过 3 年减分、中间与"日期未知"不加不减。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant.assistant_web_search import parse_bing_rss
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.dates import (
    RECENCY_BONUS,
    format_context_date,
    is_recency_query,
    parse_published_at,
    recency_bonus,
)


def _days_ago(days: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


def test_parse_bing_rss_keeps_pubdate():
    xml = (
        "<rss><channel><item>"
        "<title>2026 届校园招聘公告</title>"
        "<link>https://careers.example.com/campus</link>"
        "<description>校园招聘行程说明</description>"
        "<pubDate>Sun, 02 Nov 2025 08:30:00 GMT</pubDate>"
        "</item></channel></rss>"
    ).encode()
    results = parse_bing_rss(xml)
    assert results[0]["published_at"] == "2025-11-02T08:30:00Z"


def test_parse_bing_rss_without_pubdate_has_no_field():
    """解析不出来就**不带这个字段**（下游显示「日期未知」），绝不拿抓取时间顶替。"""
    xml = (
        "<rss><channel><item><title>招聘</title>"
        "<link>https://careers.example.com/x</link></item></channel></rss>"
    ).encode()
    assert "published_at" not in parse_bing_rss(xml)[0]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Sun, 02 Nov 2025 08:30:00 GMT", "2025-11-02T08:30:00Z"),
        ("2025-11-02", "2025-11-02"),
        ("2025-11-02T08:30:00Z", "2025-11-02T08:30:00Z"),
        ("2025年11月2日", "2025-11-02"),
        ("2025-11-02 更新", "2025-11-02"),
        ("", ""),
        ("昨天", ""),
    ],
)
def test_parse_published_at_variants(raw: str, expected: str):
    assert parse_published_at(raw) == expected


def test_format_context_date_falls_back_to_the_unknown_label():
    assert format_context_date("2025-11-02") == "2025-11-02"
    assert format_context_date("") == "日期未知"


def test_recency_bonus_thresholds():
    assert is_recency_query("2026 最新招聘岗位") is True
    assert is_recency_query("后端 招聘") is False
    today = date(2026, 11, 10)
    assert recency_bonus(_days_ago(30), today=today) == RECENCY_BONUS
    assert recency_bonus(_days_ago(365 * 2), today=today) == 0.0
    assert recency_bonus(_days_ago(365 * 4), today=today) == -RECENCY_BONUS
    # 日期未知不加不减（不猜）。
    assert recency_bonus("", today=today) == 0.0


@pytest.mark.asyncio
async def test_recency_query_puts_newer_results_first_without_dropping_old_ones(monkeypatch):
    """「最新」类查询：新结果排前，旧结果**仍在列表里**（降权不丢弃）。"""

    async def fake_bing(_query: str):
        return [
            {
                "title": "后端招聘 2021 年公告",
                "url": "https://careers.example.com/old",
                "snippet": "后端招聘岗位说明",
                # 单源排第一（RRF 更高），但已超过 3 年。
                "published_at": _days_ago(365 * 5),
            },
            {
                "title": "后端招聘 最新岗位",
                "url": "https://careers.example.com/new",
                "snippet": "后端招聘岗位说明",
                "published_at": _days_ago(10),
            },
        ]

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    results = await aggregate_search(
        "后端 招聘 最新", SearchConfig(sources=["bing"], depth="snippet")
    )
    urls = [item["url"] for item in results]
    assert urls == [
        "https://careers.example.com/new",
        "https://careers.example.com/old",
    ]
    # 一条都没丢，并且明确告诉用户"已按时间排序"。
    assert len(results) == 2
    assert results.sorted_by_time is True
    assert any("已按时间排序" in note for note in results.notes)


@pytest.mark.asyncio
async def test_plain_query_keeps_rrf_order(monkeypatch):
    """不带时效词的查询不改排序（时间只展示，不参与加权）。"""

    async def fake_bing(_query: str):
        return [
            {
                "title": "后端招聘 A",
                "url": "https://careers.example.com/a",
                "snippet": "后端招聘岗位说明",
                "published_at": _days_ago(365 * 5),
            },
            {
                "title": "后端招聘 B",
                "url": "https://careers.example.com/b",
                "snippet": "后端招聘岗位说明",
                "published_at": _days_ago(1),
            },
        ]

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="snippet"))
    assert [item["url"] for item in results] == [
        "https://careers.example.com/a",
        "https://careers.example.com/b",
    ]
    assert results.sorted_by_time is False


@pytest.mark.asyncio
async def test_tool_context_marks_the_date_on_the_title_line(db_session, monkeypatch):
    """进模型上下文的标题行形如 ``[来源1] 2025-11-02 · 标题``；未知标「日期未知」。"""
    from app.services.assistant_tools.search_tools import _tool_web_search

    async def fake_search(_query: str, _config, limit=None, *, depth=None):
        return [
            {
                "title": "后端招聘岗位",
                "url": "https://careers.example.com/1",
                "snippet": "岗位说明",
                "published_at": "2025-11-02",
            },
            {
                "title": "没有日期的岗位",
                "url": "https://careers.example.com/2",
                "snippet": "岗位说明",
            },
        ]

    monkeypatch.setattr("app.services.search.aggregate_search", fake_search)
    result = await _tool_web_search(db_session, {"query": "后端 招聘"})
    assert "[来源1] 2025-11-02 · 后端招聘岗位" in result.text
    assert "[来源2] 日期未知 · 没有日期的岗位" in result.text
