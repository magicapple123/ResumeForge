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


def _transport(routes: dict[str, httpx.Response], requests_log: list[str]) -> httpx.MockTransport:
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
        "https://careers.example.com/jobs/2": _redirect("https://careers.example.com/jobs/3"),
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
async def test_fetch_rejects_a_redirect_to_loopback_before_requesting_it(fake_public_dns, caplog):
    # 不带端口：让"解析到非公网地址"这条 IP 校验（而不是端口策略）来拒绝它。
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://127.0.0.1/jobs")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]  # 第二跳从未发出
    assert "非公网地址" in caplog.text  # 错误信息可读


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_the_link_local_metadata_address(fake_public_dns, caplog):
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
    """端口策略：只放行标准 Web 端口——内网服务恰恰集中在非标准端口上。

    A09 覆盖项：已有实现，补验证证据（``_ALLOWED_PORTS`` + ``_policy_reason`` 的端口判定，
    在每一跳上重跑）。
    """
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://careers.example.com:8080/")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
    assert "8080" in caplog.text


@pytest.mark.asyncio
async def test_fetch_gives_up_beyond_the_redirect_hop_cap(fake_public_dns, caplog):
    """链上每页都再跳一跳：到上限就放弃，第 5 跳的请求永远不会发出。

    A09 覆盖项：已有实现，补验证证据（``_MAX_REDIRECTS`` 的 ``for`` 循环耗尽即返回空串，
    不会把"超过跳数"当成错误抛进调用方）。
    """
    log: list[str] = []
    routes = {
        f"https://careers.example.com/jobs/{index}": _redirect(f"/jobs/{index + 1}")
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

    text = await fetch_page_text(PUBLIC_URL, transport=httpx.MockTransport(handler), max_chars=100)
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


# ===== A09：地址族、多地址解析与重定向边界的合成复核 =====
#
# 这些用例全部离线：只 monkeypatch ``socket.getaddrinfo`` 与注入 MockTransport，不访问
# 任何真实外网（A09 验收要求）。部分是"已有实现，补验证证据"的回归钉——写 docstring 说明
# 哪几行代码本来就在挡，避免后人把回归用例当成新防护的功劳。

PUBLIC_IP_FOR_A09 = "93.184.216.34"
# 私网 / 回环 / 链路本地 / CGNAT 共享段。CGNAT 那一项是 ``ipaddress`` 判定不到的空档。
NON_PUBLIC_IPV4 = ["10.0.0.5", "172.16.5.4", "127.0.0.1", "169.254.1.1", "100.64.0.1"]
# IPv6 回环 / 链路本地 / 唯一本地（fc00::/7）/ IPv4-mapped 回环。
NON_PUBLIC_IPV6 = ["::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]


def _family_for(address: str) -> int:
    """按地址形态选 AF_INET / AF_INET6，供假 getaddrinfo 拼标准的五元组。"""
    import socket

    return socket.AF_INET6 if ":" in address else socket.AF_INET


@pytest.fixture
def fake_multi_address_dns(monkeypatch):
    """让一个主机名解析出**多条**地址（真实 ``getaddrinfo`` 常常同时给 A 与 AAAA）。

    不能复用 ``conftest.fake_public_dns``：那个假 DNS 每个主机名只返回一条地址，证明不了
    "任一地址是内网就整条拒绝"（只看第一条的实现也能通过）。这里刻意把内网地址放在
    **第二位**，字面 IP 仍原样返回（理由同 conftest：换掉就等于没验防护）。
    """
    import socket

    answers = {
        "mixed.example.com": [PUBLIC_IP_FOR_A09, "10.0.0.5"],
        "mixed-v6.example.com": [PUBLIC_IP_FOR_A09, "fd12:3456::1"],
        "private-first.example.com": ["169.254.1.1", PUBLIC_IP_FOR_A09],
        "all-public.example.com": [PUBLIC_IP_FOR_A09, "8.8.8.8"],
    }

    def _getaddrinfo(host, port, *args, **kwargs):  # noqa: ARG001
        addresses = answers.get(str(host), [PUBLIC_IP_FOR_A09])
        return [
            (_family_for(address), socket.SOCK_STREAM, 6, "", (address, port or 0))
            for address in addresses
        ]

    monkeypatch.setattr(socket, "getaddrinfo", _getaddrinfo)


@pytest.mark.parametrize("address", NON_PUBLIC_IPV4)
def test_ipv4_non_public_addresses_are_rejected(fake_public_dns, address):
    """已有实现，补验证证据：``_policy_reason`` 逐个 IP 查 private/loopback/link_local。

    额外钉住 CGNAT（``100.64.0.0/10``）：``ipaddress`` 既不认为它 private 也不认为它
    reserved，是这条链上唯一的空档，现由 ``services/net_policy.py``（唯一实现，与更新下载
    共用）单独点名拒绝。
    """
    url = f"http://{address}/jobs"
    reason = _policy_reason(url, _sync_resolve)
    assert reason is not None, f"{address} 应当被拒绝"
    assert address in reason  # 原因里带地址，日志能看出是哪一条挡的
    assert is_public_http_url(url) is False


@pytest.mark.parametrize("address", NON_PUBLIC_IPV6)
def test_ipv6_non_public_addresses_are_rejected(fake_public_dns, address):
    """已有实现，补验证证据：IPv6 走同一份判定（回环/链路本地/唯一本地/映射）。

    字面 IPv6 必须带方括号才能进 URL；``urlsplit`` 的 ``hostname`` 会去掉方括号，
    因此送进 IP 校验的仍是纯地址字符串。
    """
    url = f"http://[{address}]/jobs"
    reason = _policy_reason(url, _sync_resolve)
    assert reason is not None, f"{address} 应当被拒绝"
    assert address in reason
    assert is_public_http_url(url) is False


@pytest.mark.asyncio
async def test_fetch_rejects_ipv6_loopback_without_any_request(fake_public_dns):
    """拒绝发生在发请求之前：异步路径（``asyncio.to_thread`` 里校验）也一样。"""
    log: list[str] = []
    text = await fetch_page_text("http://[::1]/jobs", transport=_transport({}, log))
    assert text == ""
    assert log == []


def test_one_private_answer_among_many_rejects_the_whole_host(fake_multi_address_dns):
    """多地址解析：**每一条**都查，不是只看第一条。

    内网地址在第二位，所以"只检查 ``addresses[0]``"的实现会漏掉它。公网地址在前
    也不改变结论——这正是 DNS 轮询/双栈场景下的真实形态。
    """
    reason = _policy_reason("https://mixed.example.com/jobs", _sync_resolve)
    assert reason is not None
    assert "10.0.0.5" in reason
    assert is_public_http_url("https://mixed.example.com/jobs") is False


def test_private_answer_first_is_also_rejected(fake_multi_address_dns):
    """顺序无关：内网地址排第一时同样拒绝（补上"逐个查"的另一半证据）。"""
    reason = _policy_reason("https://private-first.example.com/jobs", _sync_resolve)
    assert reason is not None
    assert "169.254.1.1" in reason


def test_ipv6_private_answer_among_many_rejects_the_host(fake_multi_address_dns):
    """混合 A + AAAA 解析：IPv6 唯一本地地址在第二位也照样拒绝。"""
    reason = _policy_reason("https://mixed-v6.example.com/jobs", _sync_resolve)
    assert reason is not None
    assert "fd12:3456::1" in reason


def test_all_public_answers_still_pass(fake_multi_address_dns):
    """对照组：多条地址全部公网时**不能**误伤（证明上面几条不是因为"多地址"而失败）。"""
    assert _policy_reason("https://all-public.example.com/jobs", _sync_resolve) is None
    assert is_public_http_url("https://all-public.example.com/jobs") is True


@pytest.mark.asyncio
async def test_fetch_rejects_a_multi_address_host_with_one_private_answer(
    fake_multi_address_dns,
):
    """同一性质在请求路径上再验一次：整条请求从未发出。"""
    log: list[str] = []
    text = await fetch_page_text("https://mixed.example.com/jobs", transport=_transport({}, log))
    assert text == ""
    assert log == []


@pytest.mark.asyncio
async def test_fetch_rejects_a_redirect_to_an_ipv6_private_address(fake_public_dns, caplog):
    """已有实现（IPv4 内网跳转已覆盖），补 IPv6 目标的证据：第二跳在发出前被拒。"""
    log: list[str] = []
    routes = {PUBLIC_URL: _redirect("http://[fd12:3456::1]/internal")}
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
    assert "fd12:3456::1" in caplog.text


@pytest.mark.asyncio
async def test_fetch_stops_on_a_3xx_without_location(fake_public_dns, caplog):
    """3xx 但没有 Location：明确放弃，不当成"再抓一次当前地址"（否则就是无限循环）。"""
    log: list[str] = []
    routes = {PUBLIC_URL: httpx.Response(302)}  # 刻意不带 location 头
    with caplog.at_level(logging.INFO, logger=_LOGGER):
        text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]  # 只发了首跳，没有重试也没有死循环
    assert "Location" in caplog.text


@pytest.mark.asyncio
async def test_fetch_stops_on_a_3xx_with_an_empty_location(fake_public_dns):
    """空字符串 Location 与"没有 Location"同一处理：同样是停止，不是循环。"""
    log: list[str] = []
    routes = {PUBLIC_URL: httpx.Response(301, headers={"location": ""})}
    text = await fetch_page_text(PUBLIC_URL, transport=_transport(routes, log))
    assert text == ""
    assert log == [PUBLIC_URL]
