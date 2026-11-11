# SPDX-License-Identifier: Apache-2.0
"""链接抓取的地基：SSRF 防护、双引擎、自动升级与任务预算（#16A）。

全部离线：httpx 用 MockTransport，浏览器用假函数，DNS 用注入的解析器。
"""

from __future__ import annotations

from unittest import mock

import httpx
import pytest
from app.services.web_fetch.errors import WebFetchError
from app.services.web_fetch.fetcher import (
    MAX_PAGES_PER_TASK,
    FetchConfig,
    JobFetcher,
)
from app.services.web_fetch.http_engine import fetch_http
from app.services.web_fetch.url_policy import (
    HostRateLimiter,
    UrlRejected,
    resolve_and_check,
    validate_url_syntax,
)

PUBLIC_IP = "93.184.216.34"
STATIC_HTML = (
    "<html><body><h1>招聘</h1>"
    + "".join(
        f"<div class='job-card'><a href='/jobs/{i}'>岗位 {i}</a><span>北京</span></div>"
        for i in range(30)
    )
    + "</body></html>"
)
SPA_HTML = '<html><body><div id="root"></div><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script></body></html>'


def _resolver(_host: str, _port: int) -> list[str]:
    return [PUBLIC_IP]


def _client(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _html_handler(body: str, status: int = 200, headers: dict[str, str] | None = None):
    def handler(_request: httpx.Request) -> httpx.Response:
        merged = {"content-type": "text/html; charset=utf-8"}
        merged.update(headers or {})
        return httpx.Response(status, text=body, headers=merged)

    return handler


def test_loopback_and_metadata_urls_are_rejected_without_leaking_details():
    """两个内网地址必须被拒；错误文案不得带出内网 IP / 端口（会进模型上下文与日志）。"""
    for url in ("http://127.0.0.1:8005/api/health", "http://169.254.169.254/"):
        with pytest.raises(UrlRejected) as excinfo:
            resolve_and_check(url, resolver=_resolver)
        message = str(excinfo.value)
        assert "127.0.0.1" not in message
        assert "169.254" not in message
        assert "8005" not in message
        assert message.strip()


def test_non_http_scheme_and_non_default_port_are_rejected():
    with pytest.raises(UrlRejected):
        validate_url_syntax("ftp://example.com/jobs")
    with pytest.raises(UrlRejected):
        validate_url_syntax("http://example.com:8080/jobs")
    with pytest.raises(UrlRejected):
        validate_url_syntax("file:///etc/passwd")
    # 带 userinfo 的 URL 也要拒：常见钓鱼形态，且会把凭据写进日志。
    with pytest.raises(UrlRejected):
        validate_url_syntax("https://user:pass@example.com/jobs")


def test_private_resolved_ip_is_rejected_even_if_first_ip_is_public():
    """DNS 返回多个地址时任何一个私有都要整条拒绝（防 DNS 轮询绕过）。"""
    with pytest.raises(UrlRejected):
        resolve_and_check(
            "https://example.com/jobs", resolver=lambda _h, _p: [PUBLIC_IP, "10.0.0.5"]
        )
    with pytest.raises(UrlRejected):
        resolve_and_check("https://example.com/jobs", resolver=lambda _h, _p: ["::1"])


def test_each_redirect_hop_is_revalidated():
    """公网 URL 302 到内网：第二跳必须被拦下，不能返回内网内容。"""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1:8005/api/health"})

    with pytest.raises(UrlRejected):
        fetch_http(
            "https://example.com/jobs",
            transport=_client(handler),
            resolver=_resolver,
        )
    assert seen == ["https://example.com/jobs"]


def test_non_html_content_type_is_rejected():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"%PDF-1.4", headers={"content-type": "application/pdf"})

    with pytest.raises(WebFetchError) as excinfo:
        fetch_http("https://example.com/jobs", transport=_client(handler), resolver=_resolver)
    assert "网页" in str(excinfo.value)


def test_response_over_limit_is_rejected():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"<html>" + b"x" * 4096 + b"</html>",
            headers={"content-type": "text/html"},
        )

    with pytest.raises(WebFetchError) as excinfo:
        fetch_http(
            "https://example.com/jobs",
            transport=_client(handler),
            resolver=_resolver,
            max_bytes=1024,
        )
    assert "上限" in str(excinfo.value)


def test_static_page_never_starts_the_browser():
    """静态 HTML 用 http 引擎即可：不调用浏览器抓取，也不启动 BrowserManager。"""
    browser = mock.Mock()
    start = mock.patch("app.services.browser.browser_manager.BrowserManager.start", autospec=True)
    with start as browser_start:
        fetcher = JobFetcher(
            http_transport=_client(_html_handler(STATIC_HTML)),
            browser_fetcher=browser,
            resolver=_resolver,
            config=FetchConfig(min_interval=0),
        )
        page = fetcher.fetch("https://example.com/campus")
    assert page.engine == "http"
    assert browser.call_count == 0
    assert browser_start.call_count == 0
    assert "岗位 0" in page.text


def test_short_spa_shell_upgrades_to_browser():
    """正文 <800 且带 __NEXT_DATA__：自动升级到浏览器引擎。"""
    browser = mock.Mock(
        return_value=mock.Mock(
            url="https://example.com/campus",
            status_code=200,
            content_type="text/html",
            text="浏览器渲染出来的岗位列表 " * 30,
            json_payloads=[{"data": [{"title": "后端开发", "city": "北京", "salary": "25-40K"}]}],
            engine="browser",
        )
    )
    fetcher = JobFetcher(
        http_transport=_client(_html_handler(SPA_HTML)),
        browser_fetcher=browser,
        resolver=_resolver,
        config=FetchConfig(min_interval=0),
    )
    page = fetcher.fetch("https://example.com/campus")
    assert browser.call_count == 1
    assert page.engine == "browser"
    assert page.json_payloads
    assert SPA_HTML


def test_forced_http_engine_does_not_upgrade():
    browser = mock.Mock()
    fetcher = JobFetcher(
        http_transport=_client(_html_handler(SPA_HTML)),
        browser_fetcher=browser,
        resolver=_resolver,
        config=FetchConfig(engine="http", min_interval=0),
    )
    page = fetcher.fetch("https://example.com/campus")
    assert page.engine == "http"
    assert browser.call_count == 0


def test_json_response_is_kept_as_payload():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"data": [{"title": "Java 开发", "city": "上海", "salary": "20-30K"}]},
        )

    fetcher = JobFetcher(
        http_transport=_client(handler), resolver=_resolver, config=FetchConfig(min_interval=0)
    )
    page = fetcher.fetch("https://example.com/api/jobs")
    assert page.content_type.startswith("application/json")
    assert page.json_payloads and page.json_payloads[0]["data"][0]["title"] == "Java 开发"


def test_task_page_budget_and_per_host_interval():
    """单任务最多 10 页；同域第二次请求至少等 2s（假时钟验证，不真等）。"""
    clock = {"now": 0.0}
    slept: list[float] = []

    def sleeper(seconds: float) -> None:
        slept.append(seconds)
        clock["now"] += seconds

    def handler(_request: httpx.Request) -> httpx.Response:
        clock["now"] += 0.1
        return httpx.Response(200, json={"ok": True})

    fetcher = JobFetcher(
        http_transport=_client(handler),
        resolver=_resolver,
        limiter=HostRateLimiter(min_interval=2.0, clock=lambda: clock["now"], sleeper=sleeper),
        config=FetchConfig(max_pages=MAX_PAGES_PER_TASK),
    )
    fetcher.fetch("https://example.com/a")
    fetcher.fetch("https://example.com/b")
    assert slept and slept[0] > 1.5
    for index in range(MAX_PAGES_PER_TASK - 2):
        fetcher.fetch(f"https://example.com/page-{index}")
    assert fetcher.pages_fetched == MAX_PAGES_PER_TASK
    with pytest.raises(WebFetchError) as excinfo:
        fetcher.fetch("https://example.com/too-many")
    assert "上限" in str(excinfo.value)
