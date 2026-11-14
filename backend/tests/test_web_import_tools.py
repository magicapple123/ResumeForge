# SPDX-License-Identifier: Apache-2.0
"""链接抓取助手工具（#16D）：只读工具、写工具提案、条数上限与「抓不到就说抓不到」。

工具注册行由主代理合入 _registry.py；这里直接对 WEB_TOOLS 声明与 handler 断言契约。
"""

from __future__ import annotations

import asyncio

import pytest
from app.services.assistant_tools import web_tools
from app.services.assistant_tools._tools_specs_web import WEB_TOOLS
from app.services.assistant_tools._types import ToolPermission
from app.services.web_fetch import import_service
from app.services.web_fetch.errors import WebFetchError
from app.services.web_fetch.fetcher import FetchedPage, FetchedPages

LIST_URL = "https://jobs.example.com/campus/position"
LIST_PAYLOAD = {
    "data": {
        "jobs": [
            {
                "jobTitle": "后端开发工程师",
                "cityName": "北京",
                "salaryDesc": "25-40K",
                "jobUrl": "/campus/position/1",
                "companyName": "示例科技",
            },
            {
                "jobTitle": "前端开发工程师",
                "cityName": "上海",
                "salaryDesc": "20-35K",
                "jobUrl": "/campus/position/2",
                "companyName": "示例网络",
            },
        ]
    }
}


def _list_page() -> FetchedPage:
    return FetchedPage(
        url=LIST_URL,
        status_code=200,
        content_type="application/json",
        text="",
        engine="http",
        fetched_on="2026-11-11",
        json_payloads=[LIST_PAYLOAD],
    )


class FakeFetcher:
    pages: dict[str, object] = {}
    last_pages: int = 1

    def __init__(self, _db=None, *, config=None) -> None:
        self.config = config

    def fetch(self, url: str, *, engine: str | None = None) -> FetchedPage:
        value = FakeFetcher.pages.get(url)
        if value is None:
            raise WebFetchError("这个页面抓不到")
        if isinstance(value, Exception):
            raise value
        return value  # type: ignore[return-value]

    def fetch_pages(
        self, url: str, *, pages: int = 1, engine: str | None = None, stop_after_first=None
    ) -> FetchedPages:
        from app.services.web_fetch.fetcher import FetchedPages

        FakeFetcher.last_pages = pages
        page = self.fetch(url, engine=engine)
        return FetchedPages(
            pages=(page,), pages_fetched=1, truncated=False, stop_reason="no_next", errors=()
        )


@pytest.fixture(autouse=True)
def _fake_fetcher(monkeypatch):
    FakeFetcher.pages = {LIST_URL: _list_page()}
    monkeypatch.setattr(web_tools, "JobFetcher", FakeFetcher)
    monkeypatch.setattr(import_service, "JobFetcher", FakeFetcher)
    yield
    FakeFetcher.pages = {}


def run(coro):
    return asyncio.run(coro)


def test_tools_are_registered_in_the_shared_registry():
    """WEB_TOOLS 已由主代理合入 _registry；这里钉住注册不会静默丢失。"""
    from app.services.assistant_tools._registry import tool_names

    names = set(tool_names())
    assert {"web_extract", "import_jobs_from_url"} <= names


def test_two_tools_are_declared_with_expected_permissions():
    by_name = {tool.name: tool for tool in WEB_TOOLS}
    assert set(by_name) == {"web_extract", "import_jobs_from_url"}
    assert by_name["web_extract"].permission is ToolPermission.READ_ONLY
    assert by_name["web_extract"].preview is None
    assert by_name["import_jobs_from_url"].permission is ToolPermission.REVERSIBLE_WRITE
    assert by_name["import_jobs_from_url"].preview is not None
    # 抓取网页也是联网行为：关掉联网开关时两条工具都不应下发。
    assert all(tool.requires_web_search for tool in WEB_TOOLS)


def test_descriptions_pin_the_three_hard_rules():
    for tool in WEB_TOOLS:
        description = tool.description
        assert "如实" in description and "抓不到" in description
        assert "搜索结果" in description  # 禁止退回搜索推测
        assert "编造" in description
        assert "岗位广场" in description and "不自动投递" in description
    extract = next(tool for tool in WEB_TOOLS if tool.name == "web_extract")
    assert "先" in extract.description and "反问" in extract.description


def test_web_extract_job_list_returns_rows_with_evidence(db_session):
    result = run(
        web_tools._tool_web_extract(db_session, {"url": LIST_URL, "intent": "job_list", "limit": 2})
    )
    assert result.summary == "读取链接：2 条岗位"
    assert "后端开发工程师" in result.text
    assert "前端开发工程师" in result.text
    assert "2 条" in result.text
    assert result.link == LIST_URL


def test_web_extract_fetch_failure_is_honest(db_session):
    result = run(
        web_tools._tool_web_extract(db_session, {"url": "https://jobs.example.com/missing"})
    )
    assert "抓不到" in result.text
    assert "禁止改用搜索结果推测" in result.text
    assert "原因：" in result.text


def test_web_extract_empty_page_says_no_jobs(db_session):
    FakeFetcher.pages[LIST_URL] = FetchedPage(
        url=LIST_URL,
        status_code=200,
        content_type="text/html",
        text="公司简介页面，没有任何岗位",
        engine="http",
        fetched_on="2026-11-11",
        html="<html><body><p>公司简介页面，没有任何岗位</p></body></html>",
    )
    result = run(web_tools._tool_web_extract(db_session, {"url": LIST_URL}))
    assert "没有识别出岗位" in result.text
    assert "如实" in result.text


def test_import_over_limit_is_refused_without_side_effects(db_session):
    result = run(web_tools._tool_import_jobs_from_url(db_session, {"url": LIST_URL, "limit": 50}))
    assert "20" in result.text
    assert "分批" in result.text
    assert result.changed is False


def test_import_jobs_creates_records_and_skips_duplicates(db_session):
    first = run(web_tools._tool_import_jobs_from_url(db_session, {"url": LIST_URL, "limit": 2}))
    assert first.changed is True
    assert "导入 2 条" in first.text
    assert "没有自动投递" in first.text
    second = run(web_tools._tool_import_jobs_from_url(db_session, {"url": LIST_URL, "limit": 2}))
    assert second.changed is False
    assert "跳过 2 条" in second.text


def test_import_filters_only_match_existing_rows(db_session):
    result = run(
        web_tools._tool_import_jobs_from_url(
            db_session, {"url": LIST_URL, "limit": 2, "filters": {"keyword": "前端"}}
        )
    )
    assert "导入 1 条" in result.text


def test_write_tool_preview_lists_titles_and_companies(db_session):
    tool = next(tool for tool in WEB_TOOLS if tool.name == "import_jobs_from_url")
    preview = tool.preview(db_session, {"url": LIST_URL, "limit": 2})
    assert "2 条岗位" in preview.target
    assert preview.scope == "岗位广场"
    assert len(preview.changes) == 2
    assert "后端开发工程师" in preview.changes[0].after
    assert "示例科技" in preview.changes[0].after


def test_write_tool_preview_with_filters_reflects_count(db_session):
    tool = next(tool for tool in WEB_TOOLS if tool.name == "import_jobs_from_url")
    preview = tool.preview(
        db_session, {"url": LIST_URL, "limit": 2, "filters": {"keyword": "前端"}}
    )
    assert "1 条岗位" in preview.target


def test_write_tool_preview_fetch_failure_raises_public_error(db_session):
    tool = next(tool for tool in WEB_TOOLS if tool.name == "import_jobs_from_url")
    with pytest.raises(WebFetchError) as excinfo:
        tool.preview(db_session, {"url": "https://jobs.example.com/missing"})
    assert "抓不到" in str(excinfo.value)


def _fake_fetched_pages(tmp_path=None):
    from app.services.web_fetch.fetcher import FetchedPages

    return FetchedPages(
        pages=(),
        pages_fetched=1,
        truncated=True,
        stop_reason="http_error",
        errors=("抓取第 2 页失败：页面返回 HTTP 500",),
    )


def test_web_extract_passes_pages_through(db_session, monkeypatch):
    captured: dict = {}

    async def fake_preview(_db, url, **kwargs):
        captured.update({"url": url, **kwargs})
        return {
            "url": url,
            "engine": "http",
            "method": "rules",
            "fetched_on": "2026-11-12",
            "total": 0,
            "rows": [],
            "warnings": [],
            "pages_requested": kwargs.get("pages", 1),
            "pages_fetched": 1,
            "truncated": False,
            "stop_reason": "no_next",
        }

    monkeypatch.setattr(web_tools, "preview_from_url", fake_preview)
    run(
        web_tools._tool_web_extract(db_session, {"url": LIST_URL, "intent": "job_list", "pages": 3})
    )
    assert captured["pages"] == 3


def test_import_tool_passes_pages_through(db_session, monkeypatch):
    captured: dict = {}

    async def fake_preview(_db, url, **kwargs):
        captured.update({"url": url, **kwargs})
        return {
            "url": url,
            "engine": "http",
            "method": "rules",
            "fetched_on": "2026-11-12",
            "total": 1,
            "rows": [
                {
                    "data": {"title": "后端开发工程师", "company": "示例科技"},
                    "detail_url": "https://jobs.example.com/campus/position/1",
                    "summary": "摘要",
                }
            ],
            "warnings": [],
            "pages_requested": kwargs.get("pages", 1),
            "pages_fetched": 2,
            "truncated": False,
            "stop_reason": "no_next",
        }

    monkeypatch.setattr(web_tools, "preview_from_url", fake_preview)
    result = run(
        web_tools._tool_import_jobs_from_url(db_session, {"url": LIST_URL, "limit": 1, "pages": 2})
    )
    assert captured["pages"] == 2
    assert "共抓取 2 页" in result.text


def test_proposal_preview_reports_pagination_failure(db_session, monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "preview_rules_from_url",
        lambda *_args, **_kwargs: (
            [],
            _fake_fetched_pages(),
            ["抓取第 2 页失败：页面返回 HTTP 500"],
        ),
    )
    preview = web_tools.preview_import_jobs_from_url(db_session, {"url": LIST_URL, "pages": 2})
    fields = [change.field for change in preview.changes]
    assert "抓取说明" in fields
    note = next(change.after for change in preview.changes if change.field == "抓取说明")
    assert "抓取第 2 页失败" in note
    assert "抓取中途失败" in preview.target or "没有从" in preview.target
