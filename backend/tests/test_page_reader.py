# SPDX-License-Identifier: Apache-2.0
"""page_reader 的 URL 边界与抓取预算（RF-04），全部离线：httpx.MockTransport + 假 DNS。

防护本身必须在被测路径上（见 ``conftest.fake_public_dns`` 的说明）——这里替换的是
``socket.getaddrinfo``、注入 MockTransport，**绝不**把 ``is_public_http_url`` 打成桩。

钉住的三类性质：
- 重定向的**每一跳**都重新过同一套公网校验：跳到 127.0.0.1 / 169.254.169.254 /
  10.x / 非 http(s) scheme / user:pass@ / 非标准端口，全部在发出请求前拒绝；
- 跳数上限与总墙钟预算：超限放弃，不拖垮助手流；
- 正常公网页面（含限额内的重定向链）照常抓回正文。
"""
import asyncio
import logging
import time

import httpx
import pytest
from app.services.search import page_reader
from app.services.search.page_reader import (
    MAX_PAGE_BYTES,
    _policy_reason,
    _sync_resolve,
    fetch_page_text,
    is_public_http_url,
)

PAGE = "<html><body><p>这是一段足够长的正文内容，用来验证正文提取会保留它。</p></body></html>"
PUBLIC_URL = "https://careers.example.com/jobs/1"
_LOGGER = "app.services.search.page_reader"


def _transport(
    routes: dict[str, httpx.Response], requests_log: list[str]
) -> httpx.MockTransport:
    """把路由表换成 MockTransport；真实发出的每个请求都记进 ``requests_log``。"""

    async def handler(request: httpx.Request) -> httpx.Response:
        requests_log.append(str(request.url))
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.MockTransport(handler)


def _redirect(target: str) -> httpx.Response:
    return httpx.Response(302, headers={"location": target})


def _page() -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "text/html"}, text=PAGE)


# ===== 首跳校验 =====


@pytest.mark.asyncio
async def test_fetch_rejects_an_unsafe_first_hop_without_any_request(fake_public_dns):
    log: list[str] = []
    text = await fetch_page_text("http://127.0.0.1:8080/jobs", transport=_transport({}, log))
    assert text == ""
    assert log == []  # 第一个请求都没发出去


# ===== 重定向逐跳校验 =====


@pytest.mark.asyncio
async def test_fetch_follows_redirects_within_limit_and_returns_text(fake_public_dns):
    """限额内的重定向链正常跟随：相对与绝对 Location 都支持。"""
    log: list[str] = []
    routes = {
        "https://careers.example.com/jobs/1": _redirect("/jobs/2"),
        "https://careers.example.com/jobs/2": _redirect(
            "https://careers.example.com/jobs/3"
        ),
        "https://careers.example.com/jobs/3": _page(),
    }
    text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert "足够长的正文内容" in text
    assert log == [
        "https://careers.example.com/jobs/1",
        "https://careers.example.com/jobs/2",
        "https://careers.example.com/jobs/3",
    ]


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_loopback_before_requesting_it(
    fake_public_dns, caplog
):
    # 不带端口：让"解析到非公网地址"这条 IP 校验（而不是端口策略）来拒绝它。
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://127.0.0.1/jobs")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]  # 第二跳从未发出
    assert "非公网地址" in caplog.text  # 错误信息可读


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_the_link_local_metadata_address(
    fake_public_dns, caplog
):
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://169.254.169.254/latest/meta-data/")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
    assert "169.254.169.254" in caplog.text


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_a_private_address(fake_public_dns):
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://10.0.0.5/internal")}
    text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_a_non_http_scheme(fake_public_dns, caplog):
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("file:///etc/passwd")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
    assert "scheme" in caplog.text


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_with_embedded_credentials(fake_public_dns, caplog):
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("https://user:pass@careers.example.com/x")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
    assert "user:pass@" in caplog.text


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_a_non_web_port(fake_public_dns, caplog):
    """端口策略：只放行标准 Web 端口——内网服务恰恰集中在非标准端口上。"""
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://careers.example.com:8080/")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
    assert "8080" in caplog.text


@pytest.mark.asyncio
async def test_fetch_gives_up_beyond_the_redirect_hop_cap(fake_public_dns, caplog):
    """链上每页都再跳一跳：到上限就放弃，第 5 跳的请求永远不会发出。"""
    log: list[str] = []
    routes = {
        f"https://careers.example.com/jobs/{index}": _redirect(
            f"/jobs/{index + 1}"
        )
        for index in range(1, 5)
    }
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert len(log) == page_reader._MAX_REDIRECTS + 1
    assert "https://careers.example.com/jobs/5" not in log
    assert "上限" in caplog.text


# ===== 预算：字节上限与总墙钟 =====


@pytest.mark.asyncio
async def test_fetch_truncates_an_oversized_response_and_stops_reading(fake_public_dns):
    consumed = {"bytes": 0}
    # 全部由**完整段落**组成：截断点之前已闭合的 <p> 要能被正文提取保留下来。
    paragraph = b"<p>" + b"A" * 30 + b"</p>"
    total = MAX_PAGE_BYTES * 5

    async def handler(_request: httpx.Request) -> httpx.Response:
        async def stream():
            remaining = total
            while remaining > 0:
                chunk = paragraph * min(3000, remaining // len(paragraph))
                remaining -= len(chunk)
                consumed["bytes"] += len(chunk)
                yield chunk

        return httpx.Response(200, headers={"content-type": "text/html"}, content=stream())

    text = await fetch_page_text(
        PUBLIC_URL, transport=httpx.MockTransport(handler), max_chars=100
    )
    assert len(text) == 100
    # 读到字节上限附近就停了，而不是把 5 倍大的响应读完。
    assert consumed["bytes"] < MAX_PAGE_BYTES + len(paragraph) * 3001


@pytest.mark.asyncio
async def test_fetch_gives_up_when_the_total_budget_expires(fake_public_dns, monkeypatch):
    """总预算覆盖所有跳；超时按"这条没有正文"返回，不抛进调用方。"""

    async def slow_handler(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(2)
        return _page()  # pragma: no cover - 预算必然先到期

    # 超时用例的预算必须真的会到期（毫秒级），成功用例的预算是安全网（见 AGENTS 两档预算）。
    monkeypatch.setattr(page_reader, "_TOTAL_BUDGET_SECONDS", 0.05)
    start = time.monotonic()
    text = await fetch_page_text(PUBLIC_URL, transport=httpx.MockTransport(slow_handler))
    elapsed = time.monotonic() - start
    assert text == ""
    assert elapsed < 1.0  # 不等慢响应的 2 秒


# ===== 同步入口契约与可读原因 =====


def test_is_public_http_url_keeps_its_sync_contract(fake_public_dns):
    assert is_public_http_url("https://careers.example.com/jobs") is True
    assert is_public_http_url("http://127.0.0.1:8080/jobs") is False
    assert is_public_http_url("http://localhost/jobs") is False
    assert is_public_http_url("http://10.0.0.5/internal") is False
    assert is_public_http_url("http://host.internal.example/x") is False
    assert is_public_http_url("file:///etc/passwd") is False
    assert is_public_http_url("https://user:pass@example.com/jobs") is False


def test_policy_reasons_are_readable(fake_public_dns):
    """拒绝时给得出人能看懂的原因（日志与异常共用这一份）。"""
    assert _policy_reason("https://user:pass@example.com/", _sync_resolve) is not None
    assert "user:pass@" in _policy_reason("https://user:pass@example.com/", _sync_resolve)
    assert "scheme" in _policy_reason("ftp://example.com/", _sync_resolve)
    assert "8080" in _policy_reason("http://example.com:8080/", _sync_resolve)
    assert "10.0.0.5" in _policy_reason("http://10.0.0.5/", _sync_resolve)
    assert _policy_reason("https://careers.example.com/jobs", _sync_resolve) is None
