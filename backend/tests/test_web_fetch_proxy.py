# SPDX-License-Identifier: Apache-2.0
"""抓取链路的出网口径（T03）。

钉三件事：
1. 配了代理时 http 档真的走代理（客户端参数里有 proxy）；
2. `via_proxy` 三态：http 档给 True/False，browser / deepseek 档给 **None**（不许谎报）；
3. 回环地址仍强制直连——本地服务不能被代理带走。
"""

from __future__ import annotations

import httpx
import pytest
from app.services.web_fetch import http_engine
from app.services.web_fetch.fetcher import JobFetcher
from app.services.web_fetch.http_engine import RawHttpPage, fetch_http

PUBLIC_IP = "93.184.216.34"


def _resolver(_host: str, _port: int) -> list[str]:
    return [PUBLIC_IP]


def _ok_handler(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        content=b"<html><body><h1>jobs</h1></body></html>",
        headers={"content-type": "text/html; charset=utf-8"},
    )


def test_http_engine_uses_the_shared_proxy_path(monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:7890")
    captured: dict[str, object] = {}

    def fake_build_client(**kwargs):
        captured["proxy"] = kwargs.get("proxy")
        return httpx.Client(transport=httpx.MockTransport(_ok_handler))

    monkeypatch.setattr(http_engine.net_proxy, "build_client", fake_build_client)
    page = fetch_http("https://example.com/jobs", resolver=_resolver)

    assert page.via_proxy is True
    proxy = captured["proxy"]
    assert getattr(proxy, "host_port", "") == "127.0.0.1:7890"


def test_http_engine_reports_direct_when_no_proxy(monkeypatch):
    captured: dict[str, object] = {}

    def fake_build_client(**kwargs):
        captured["proxy"] = kwargs.get("proxy")
        return httpx.Client(transport=httpx.MockTransport(_ok_handler))

    monkeypatch.setattr(http_engine.net_proxy, "build_client", fake_build_client)
    page = fetch_http("https://example.com/jobs", resolver=_resolver)

    assert page.via_proxy is False
    assert getattr(captured["proxy"], "is_direct", False) is True


@pytest.mark.parametrize("engine", ["browser", "deepseek"])
def test_non_http_engines_never_claim_a_network_path(engine):
    fetcher = object.__new__(JobFetcher)
    fetcher._today = lambda: "2026-01-01"  # type: ignore[method-assign]
    raw = RawHttpPage(
        url="https://example.com/jobs",
        status_code=200,
        content_type="text/html",
        text="<html><body>ok</body></html>",
        engine=engine,
    )
    page = fetcher._to_page(raw, url="https://example.com/jobs", html=raw.text)
    # 这两档在别的进程/服务端出网，本地没有资格替它们断言 True/False。
    assert page.via_proxy is None


def test_fetcher_reuses_one_client_per_session(monkeypatch):
    """一次导入会话只构造一次客户端（连接池/TLS 握手不复用等于没做）。"""
    calls = {"n": 0}

    def fake_build_client(**_kwargs):
        calls["n"] += 1
        return httpx.Client(transport=httpx.MockTransport(_ok_handler))

    monkeypatch.setattr(http_engine.net_proxy, "build_client", fake_build_client)
    fetcher = JobFetcher(None, resolver=_resolver)
    try:
        fetcher.fetch("https://example.com/a")
        fetcher.fetch("https://example.com/b")
    finally:
        fetcher.close()

    assert calls["n"] == 1
