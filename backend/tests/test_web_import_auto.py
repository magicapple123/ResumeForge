# SPDX-License-Identifier: Apache-2.0
"""网页导入的"这是详情页还是列表页"：只看 URL 会判错，必须结合页面结构。

覆盖真实形态：详情页夹着导航链接 / 列表页只有三条详情链接 / 只有导航没有岗位卡片 /
详情 URL 但既无 H1 也无 JD 结构。最后一类宁可报"没识别到"，也不能凭空造一个岗位。
"""

import asyncio

from app.services.web_fetch.extractor import extract_rows
from app.services.web_fetch.fetcher import FetchedPage
from app.services.web_fetch.html_utils import html_to_text

DETAIL_URL = "https://job.xiaohongshu.com/campus/position/22072"
DETAIL_HTML = """
<nav><a href='/campus/position/all'>Campus navigation</a>
<a href='/careers/social'>Social navigation</a></nav>
<main><h1>AI 产品经理</h1><p>工作地点：上海</p>
<h2>岗位职责</h2><p>负责 AI Agent 产品设计与用户需求分析</p>
<h2>任职资格</h2><p>熟悉 Agent 与产品设计</p></main>
"""


def _page(html, url=DETAIL_URL):
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="http",
        fetched_on="2026-11-13",
        html=html,
    )


def test_auto_detail_ignores_navigation_and_extracts_title_location_description():
    result = asyncio.run(extract_rows(_page(DETAIL_HTML), intent="auto"))
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.title == "AI 产品经理"
    assert row.data["location"] == "上海"
    assert "AI Agent 产品设计" in row.data["description"]
    assert row.data["source_url"] == DETAIL_URL


def test_auto_real_list_with_three_detail_links_stays_a_list():
    cards = "".join(
        f"<div class='job-card'><a href='/campus/position/{i}'>Role {i}</a>"
        "<span>上海</span><span>20-30K</span></div>"
        for i in range(3)
    )
    result = asyncio.run(extract_rows(_page("<h1>Jobs</h1>" + cards), intent="auto"))
    assert len(result.rows) == 3
    assert {row.title for row in result.rows} == {"Role 0", "Role 1", "Role 2"}


def test_navigation_only_is_empty_with_explicit_warning():
    html = "".join(f"<a href='/campus/position/{i}'>Navigation {i}</a>" for i in range(5))
    result = asyncio.run(extract_rows(_page(html, "https://jobs.example.com/"), intent="auto"))
    assert result.rows == []
    assert any("导航链接" in warning for warning in result.warnings)


def test_detail_url_without_heading_or_jd_structure_does_not_invent_a_job():
    result = asyncio.run(extract_rows(_page("<main>Welcome</main>"), intent="auto"))
    assert result.rows == []


def test_detail_without_h1_uses_title_before_location_instead_of_navigation():
    html = (
        "<nav>首页REDstar 顶尖校招Ace 顶尖实习生社会招聘登录</nav><div>职位列表</div>"
        "<div>【2027校招】AI审核研发工程师-Trust&amp;Safety</div>"
        "<div>【2027校招】AI审核研发工程师-Trust&amp;Safety</div>"
        "<p>工作地点：北京市，上海市，武汉市</p><h2>岗位职责</h2>"
        "<p>负责新一代AI审核系统与Multi-Agent平台建设</p>"
    )
    result = asyncio.run(extract_rows(_page(html), intent="auto"))
    assert len(result.rows) == 1
    assert result.rows[0].title == "【2027校招】AI审核研发工程师-Trust&Safety"
    assert result.rows[0].data["location"] == "北京市，上海市，武汉市"


def test_detail_title_evidence_overrides_current_url_navigation_candidate(monkeypatch):
    from app.services.web_fetch import extractor

    monkeypatch.setattr(
        extractor,
        "extract_rules",
        lambda _page: [{"data": {"title": "Home Campus Login", "source_url": DETAIL_URL}}],
    )
    result = asyncio.run(extract_rows(_page(DETAIL_HTML), intent="auto"))
    assert len(result.rows) == 1
    assert result.rows[0].title == "AI 产品经理"


def test_auto_detail_stops_before_following_next_page(monkeypatch):
    import httpx
    from app.services.web_fetch import import_service
    from app.services.web_fetch.fetcher import FetchConfig, JobFetcher

    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(
            200,
            text=DETAIL_HTML + '<a rel="next" href="/campus/position/22073">Next</a>',
            headers={"content-type": "text/html"},
        )

    fetcher = JobFetcher(
        http_transport=httpx.MockTransport(handler),
        config=FetchConfig(min_interval=0),
        resolver=lambda _host, _port: ["93.184.216.34"],
    )
    monkeypatch.setattr(import_service, "JobFetcher", lambda *_args, **_kwargs: fetcher)
    monkeypatch.setattr(import_service, "provider_for", lambda _db: None)
    monkeypatch.setattr(import_service, "_annotate_existing", lambda _db, _rows: None)
    preview = asyncio.run(import_service.preview_from_url(None, DETAIL_URL, pages=5))
    assert calls == [DETAIL_URL]
    assert preview["pages_requested"] == preview["pages_fetched"] == 1
    assert preview["total"] == 1
