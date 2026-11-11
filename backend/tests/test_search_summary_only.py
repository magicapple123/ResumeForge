# SPDX-License-Identifier: Apache-2.0
"""P4-06：反爬站点只取摘要（不发抓取请求）。

知乎、微信公众号、小红书这类站点对非浏览器请求返回登录墙/验证码页，抓到的"正文"
比摘要还少，还白挨一次风控。这里钉住：

1. 名单内域名：**不发抓取请求**，保留搜索给的 snippet；
2. 名单外域名：照常抓；
3. 这是"跳过名单"而不是"白名单"——没登记的域名一律照抓；
4. 匹配用 host 后缀（`www.zhihu.com` 命中 `zhihu.com`），但 `notzhihu.com` 不误伤。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.domains import SUMMARY_ONLY_HOSTS, is_summary_only


def test_known_crawl_hostile_sites_are_listed():
    for url in (
        "https://www.zhihu.com/question/1",
        "https://zhuanlan.zhihu.com/p/123",
        "https://mp.weixin.qq.com/s/abc",
        "https://www.xiaohongshu.com/explore/1",
        "https://www.douban.com/note/1",
    ):
        assert is_summary_only(url) is True, url
    # 常见招聘站、公司官网一律照抓（名单是跳过名单，不是白名单）。
    for url in (
        "https://careers.example.com/jobs/1",
        "https://www.zhipin.com/job/1",
        "https://notzhihu.com/x",
    ):
        assert is_summary_only(url) is False, url


def test_env_var_can_extend_the_list(monkeypatch):
    monkeypatch.setenv("RF_SEARCH_SUMMARY_ONLY_HOSTS", "corp.example.com, intranet.example.org")
    assert is_summary_only("https://news.corp.example.com/a") is True
    assert is_summary_only("https://intranet.example.org/a") is True
    assert "corp.example.com" not in SUMMARY_ONLY_HOSTS  # 常量本身不被污染


@pytest.mark.asyncio
async def test_listed_domain_is_not_fetched_and_keeps_the_snippet(monkeypatch):
    fetched: list[str] = []

    async def fake_bing(_query: str):
        return [
            {
                "title": "后端招聘 知乎讨论",
                "url": "https://zhuanlan.zhihu.com/p/1",
                "snippet": "知乎摘要内容",
            }
        ]

    async def fake_fetch(url: str, max_chars: int = 0, **_kwargs):
        fetched.append(url)
        return "抓回来的正文（后端招聘）"

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_fetch)

    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="standard"))

    assert fetched == [], "名单内的站点不该发抓取请求"
    assert results[0]["snippet"]
    assert "text" not in results[0]
    assert any("只展示摘要" in note for note in results.notes)


@pytest.mark.asyncio
async def test_unlisted_domain_is_still_fetched(monkeypatch):
    fetched: list[str] = []

    async def fake_bing(_query: str):
        return [
            {
                "title": "后端招聘官网",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "摘要",
            }
        ]

    async def fake_fetch(url: str, max_chars: int = 0, **_kwargs):
        fetched.append(url)
        return "后端招聘岗位职责：负责服务端开发。"

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_fetch)

    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], depth="standard"))
    assert fetched == ["https://careers.example.com/jobs/1"]
    assert "后端" in results[0]["text"]
