# SPDX-License-Identifier: Apache-2.0
"""#16 分页（收尾任务 2）：翻页发现 / 跨页去重 / 部分失败保留 / SSRF 拒绝。

全部离线：httpx MockTransport + 注入 DNS 解析器；不依赖外网、不启动浏览器。
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from app.services.web_fetch import import_service
from app.services.web_fetch.fetcher import (
    FetchConfig,
    FetchedPage,
    FetchedPages,
    JobFetcher,
)
from app.services.web_fetch.html_utils import html_to_text
from app.services.web_fetch.pagination import find_next_page_url, same_site_host

LIST_URL = "https://jobs.example.com/campus/position"
PAGE2_URL = "https://jobs.example.com/campus/position?page=2"
PUBLIC_IP = "93.184.216.34"


def _resolver(_host: str, _port: int) -> list[str]:
    return [PUBLIC_IP]


def _card(index: int, *, href: str | None = None) -> str:
    link = href or f"/campus/position/{index}"
    return (
        '<div class="job-card">'
        f'<a class="job-name" href="{link}">岗位 {index}</a>'
        '<span class="salary">20-30K</span><span class="location">北京</span>'
        '<span class="company">示例科技有限公司</span>'
        "</div>"
    )


def _html_page(url: str, cards: list[str], next_markup: str = "") -> FetchedPage:
    html = (
        "<html><body><div class='job-list'>"
        + "".join(cards)
        + "</div>"
        + next_markup
        + "</body></html>"
    )
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="http",
        fetched_on="2026-11-12",
        html=html,
    )


def _html_response(body: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, text=body, headers={"content-type": "text/html; charset=utf-8"})


def _transport(routes: dict[str, object], calls: list[str]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        calls.append(url)
        value = routes.get(url)
        if value is None:
            return _html_response("not found", status=404)
        if isinstance(value, Exception):
            raise value
        return value  # type: ignore[return-value]

    return httpx.MockTransport(handler)


def _fetcher(routes: dict[str, object], calls: list[str]) -> JobFetcher:
    return JobFetcher(
        None,
        http_transport=_transport(routes, calls),
        resolver=_resolver,
        config=FetchConfig(min_interval=0),
    )


def _use_fetcher(monkeypatch, routes: dict[str, object], calls: list[str]) -> None:
    """让 import_service 内部 new 出来的 JobFetcher 用我们的 MockTransport。"""

    def factory(_db=None, *, config=None):
        return _fetcher(routes, calls)

    monkeypatch.setattr(import_service, "JobFetcher", factory)
    monkeypatch.setattr(import_service, "_annotate_existing", lambda _db, _rows: None)


def _preview(url: str, *, pages: int = 1) -> dict:
    return asyncio.run(import_service.preview_from_url(None, url, pages=pages))


NEXT_REL = '<a rel="next" href="/campus/position?page=2">下一页</a>'
PAGE_ONE = _html_page(LIST_URL, [_card(1), _card(2)], NEXT_REL)
PAGE_TWO = _html_page(PAGE2_URL, [_card(1), _card(3)])  # 岗位 1 与第一页重复


def test_two_pages_are_fetched_and_deduped_across_pages(monkeypatch):
    calls: list[str] = []
    routes = {LIST_URL: _html_response(PAGE_ONE.html), PAGE2_URL: _html_response(PAGE_TWO.html)}
    _use_fetcher(monkeypatch, routes, calls)

    preview = _preview(LIST_URL, pages=2)
    assert calls == [LIST_URL, PAGE2_URL]
    assert preview["pages_requested"] == 2
    assert preview["pages_fetched"] == 2
    assert preview["stop_reason"] == "no_next"
    assert preview["truncated"] is False
    # 两页共 4 条，岗位 1 重复 → 3 条；跨页去重生效。
    titles = [row["data"]["title"] for row in preview["rows"]]
    assert len(titles) == 3
    assert titles.count("岗位 1") == 1


def test_pages_ten_but_only_two_exist_stops_with_no_next(monkeypatch):
    calls: list[str] = []
    routes = {LIST_URL: _html_response(PAGE_ONE.html), PAGE2_URL: _html_response(PAGE_TWO.html)}
    _use_fetcher(monkeypatch, routes, calls)

    preview = _preview(LIST_URL, pages=10)
    assert preview["pages_requested"] == 10
    assert preview["pages_fetched"] == 2
    assert preview["stop_reason"] == "no_next"
    assert preview["truncated"] is False
    assert len(calls) == 2


def test_single_page_with_next_marker_is_truncated(monkeypatch):
    calls: list[str] = []
    routes = {LIST_URL: _html_response(PAGE_ONE.html), PAGE2_URL: _html_response(PAGE_TWO.html)}
    fetcher = _fetcher(routes, calls)
    batch = fetcher.fetch_pages(LIST_URL, pages=1)
    assert isinstance(batch, FetchedPages)
    assert batch.pages_fetched == 1
    assert batch.stop_reason == "limit"
    assert batch.truncated is True


def test_second_page_http_error_keeps_first_page(monkeypatch):
    calls: list[str] = []
    routes = {
        LIST_URL: _html_response(PAGE_ONE.html),
        PAGE2_URL: _html_response("server exploded", status=500),
    }
    _use_fetcher(monkeypatch, routes, calls)

    preview = _preview(LIST_URL, pages=2)
    assert preview["pages_fetched"] == 1
    assert preview["truncated"] is True
    assert preview["stop_reason"] == "http_error"
    # 第一页结果保留（不整体回滚）。
    assert [row["data"]["title"] for row in preview["rows"]] == ["岗位 1", "岗位 2"]
    joined = " ".join(preview["warnings"])
    assert "第 2 页" in joined and "HTTP 500" in joined


def test_second_page_internal_url_is_rejected_without_leaking(monkeypatch):
    calls: list[str] = []
    page_one = _html_page(
        LIST_URL,
        [_card(1)],
        '<a rel="next" href="http://127.0.0.1:8005/api/health">下一页</a>',
    )
    routes = {LIST_URL: _html_response(page_one.html)}
    _use_fetcher(monkeypatch, routes, calls)

    preview = _preview(LIST_URL, pages=2)
    assert calls == [LIST_URL]  # 内网地址根本没被请求
    assert preview["pages_fetched"] == 1
    assert preview["truncated"] is True
    assert preview["stop_reason"] == "rejected"
    joined = " ".join(preview["warnings"])
    assert "127.0.0.1" not in joined
    assert "8005" not in joined
    assert preview["rows"]


def test_no_next_marker_does_not_guess_url_template(monkeypatch):
    calls: list[str] = []
    # 页面里只有「第 2 页」的普通链接：不是 rel=next、也没有「下一页」文案/分页类名。
    page_one = _html_page(LIST_URL, [_card(1)], '<a href="/campus/position?page=2">2</a>')
    routes = {LIST_URL: _html_response(page_one.html)}
    _use_fetcher(monkeypatch, routes, calls)

    preview = _preview(LIST_URL, pages=10)
    assert calls == [LIST_URL]
    assert preview["pages_fetched"] == 1
    assert preview["stop_reason"] == "no_next"
    assert preview["truncated"] is False
    assert find_next_page_url(page_one) == ""


@pytest.mark.parametrize(
    ("markup", "json_payloads", "expected"),
    [
        ('<a rel="next" href="/p2">下一页</a>', [], "https://jobs.example.com/p2"),
        ('<a href="/p2">下一页</a>', [], "https://jobs.example.com/p2"),
        ('<a href="/p2">Next</a>', [], "https://jobs.example.com/p2"),
        ('<a class="pagination-next" href="/p2">2</a>', [], "https://jobs.example.com/p2"),
        ('<link rel="next" href="/p2">', [], "https://jobs.example.com/p2"),
        ("", [{"data": {"next": "/p2"}}], "https://jobs.example.com/p2"),
        ('<a href="/p2">2</a>', [], ""),
        ('<a rel="next" href="javascript:void(0)">下一页</a>', [], ""),
    ],
)
def test_find_next_page_url_variants(markup, json_payloads, expected):
    page = FetchedPage(
        url=LIST_URL,
        status_code=200,
        content_type="text/html",
        text="",
        engine="http",
        fetched_on="2026-11-12",
        html=f"<html><head></head><body>{markup}</body></html>",
        json_payloads=json_payloads,
    )
    assert find_next_page_url(page) == expected


def test_same_site_host_is_strict_about_hostname():
    assert same_site_host(LIST_URL, PAGE2_URL) is True
    assert same_site_host(LIST_URL, "https://evil.example.com/p2") is False
    assert same_site_host(LIST_URL, "not a url") is False


def test_api_rejects_out_of_range_pages(client):
    """pages 只能是 1–10；越界在请求体校验阶段 422（不会发起网络请求）。"""
    for pages in (0, 11):
        response = client.post(
            "/api/jobs/import/from-url/preview",
            json={"url": LIST_URL, "pages": pages},
        )
        assert response.status_code == 422, response.text
