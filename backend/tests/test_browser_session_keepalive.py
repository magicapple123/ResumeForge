# SPDX-License-Identifier: Apache-2.0
"""L1 会话 Cookie 续期（T1）：fake CDP 断言属性保真与关闭顺序。

三条断言口径：

1. **属性保真**：会话 Cookie 被续成 ``expires > 0``，持久 Cookie 一个字都不改；
   ``__Host-`` / ``__Secure-`` / ``partitionKey`` 三条是最容易在真实浏览器里静默出错
   （回执只有 ``success=false``）的，所以逐条钉住。
2. **只写一次**：60 秒是扫描频率，不是写入频率。
3. **关闭顺序**：``stop()`` 必须是「停线程 → 最后一次续期 → CDP Browser.close」。
   这条用一个共享的事件表断言——续期排在 Browser.close 之后的话，端口已经关了，
   真机上就是"最后那批会话 Cookie 没被续上"，而单看会不会续期是看不出来的。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from app.services.browser.browser_manager import BrowserManager
from app.services.browser.cdp_client import CdpClient
from app.services.browser.session_cookie_keepalive import (
    SessionCookieKeepalive,
    SessionCookiePolicy,
    cookie_key,
    needs_promotion,
    promote_session_cookies,
    set_cookie_params,
)

NOW = 1_700_000_000.0
SESSION_COOKIE: dict[str, Any] = {
    "name": "sid",
    "value": "abc",
    "domain": ".moka.com",
    "path": "/",
    "expires": -1,
    "session": True,
    "secure": False,
    "httpOnly": True,
    "sameSite": "Lax",
}
PERSISTENT_COOKIE: dict[str, Any] = {
    "name": "keep",
    "value": "1",
    "domain": ".moka.com",
    "path": "/",
    "expires": NOW + 3600,
    "session": False,
}
PARTITIONED_COOKIE: dict[str, Any] = {
    "name": "p_sid",
    "value": "xyz",
    "domain": "moka.com",
    "path": "/app",
    "expires": 0,
    "session": True,
    "partitionKey": {"topLevelSite": "https://moka.com", "hasCrossSiteAncestor": False},
}


class FakeCookieClient(CdpClient):
    """假 CDP 客户端：记录 ``(method, params)``，可按名字注入失败 / 拒绝。"""

    def __init__(
        self,
        cookies: list[dict[str, Any]] | None = None,
        *,
        events: list[str] | None = None,
        raise_for: tuple[str, ...] = (),
        reject: tuple[str, ...] = (),
        get_cookies_error: BaseException | None = None,
    ) -> None:
        self.cookies = list(cookies or [])
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.events = events if events is not None else []
        self.raise_for = raise_for
        self.reject = reject
        self.get_cookies_error = get_cookies_error
        self.closed = False

    def list_targets(self) -> list[dict[str, Any]]:
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "target-1"

    def evaluate(self, expression: str, *, timeout: float | None = None) -> Any:
        return None

    def send(
        self, method: str, params: dict[str, Any] | None = None, *, timeout: float | None = None
    ) -> dict[str, Any]:
        payload = dict(params or {})
        self.calls.append((method, payload))
        self.events.append(method)
        if method == "Storage.getCookies":
            if self.get_cookies_error is not None:
                raise self.get_cookies_error
            return {"cookies": self.cookies}
        if method == "Network.setCookie":
            name = str(payload.get("name") or "")
            if name in self.raise_for:
                raise RuntimeError("cdp boom")
            if name in self.reject:
                return {"success": False}
            return {"success": True}
        return {}

    def close_browser(self, *, timeout: float | None = None) -> None:
        self.events.append("Browser.close")

    def close(self) -> None:
        self.closed = True

    # ---- 便于断言的小工具 ----

    def methods(self) -> list[str]:
        return [method for method, _params in self.calls]

    def set_cookies(self) -> list[dict[str, Any]]:
        return [params for method, params in self.calls if method == "Network.setCookie"]


# ===== 属性保真 =====


def test_session_cookie_is_promoted_to_the_configured_days():
    client = FakeCookieClient([SESSION_COOKIE, PERSISTENT_COOKIE])

    report = promote_session_cookies(client, 90, now=NOW)

    assert report.scanned == 2
    assert report.promoted == 1
    # 持久 Cookie 一条都不该被写回——写它没有收益，还会磨损 Cookie 库。
    assert client.methods() == ["Storage.getCookies", "Network.setCookie"]
    written = client.set_cookies()[0]
    assert written["name"] == "sid"
    assert written["expires"] == int(NOW + 90 * 86400)


def test_persistent_cookies_are_left_untouched():
    client = FakeCookieClient([PERSISTENT_COOKIE])

    report = promote_session_cookies(client, 90, now=NOW)

    assert report.promoted == 0
    assert client.methods() == ["Storage.getCookies"]


def test_expired_cookie_is_treated_as_a_session_cookie():
    cookie = {**SESSION_COOKIE, "expires": 0, "session": False}

    assert needs_promotion(cookie) is True


def test_host_prefix_cookie_drops_domain_and_forces_secure_and_root_path():
    cookie = {
        "name": "__Host-rf",
        "value": "v",
        "domain": "moka.com",
        "path": "/app",
        "expires": -1,
        "session": True,
        "secure": True,
        "httpOnly": True,
        "sameSite": "Strict",
    }

    params = set_cookie_params(cookie, 30, now=NOW)

    # __Host- 三条件：无 domain、path=/、secure=true。带 domain 会被 Chromium 直接拒绝。
    assert "domain" not in params
    assert params["path"] == "/"
    assert params["secure"] is True
    assert params["url"] == "https://moka.com/"
    assert params["expires"] == int(NOW + 30 * 86400)


def test_secure_prefix_cookie_keeps_secure_flag():
    cookie = {
        "name": "__Secure-rf",
        "value": "v",
        "domain": "moka.com",
        "path": "/",
        "expires": -1,
        "session": True,
        "secure": False,
    }

    params = set_cookie_params(cookie, 90, now=NOW)

    assert params["secure"] is True
    assert params["domain"] == "moka.com"


def test_partition_key_is_carried_back_verbatim():
    client = FakeCookieClient([PARTITIONED_COOKIE])

    promote_session_cookies(client, 30, now=NOW)

    written = client.set_cookies()[0]
    # 漏掉 partitionKey 会写成一条新的普通 Cookie：既没续上原来那条，还多一条影子。
    assert written["partitionKey"] == PARTITIONED_COOKIE["partitionKey"]
    assert written["path"] == "/app"
    assert written["domain"] == "moka.com"


def test_original_attributes_are_preserved():
    client = FakeCookieClient([SESSION_COOKIE])

    promote_session_cookies(client, 90, now=NOW)

    written = client.set_cookies()[0]
    assert written["domain"] == "moka.com"  # 前导点被去掉（CDP 要裸域名）
    assert written["httpOnly"] is True
    assert written["sameSite"] == "Lax"


def test_priority_is_preserved_when_present():
    cookie = {**SESSION_COOKIE, "priority": "High"}

    params = set_cookie_params(cookie, 90, now=NOW)

    assert params["priority"] == "High"


def test_unknown_enum_values_are_not_forwarded():
    """CDP 对 sameSite / priority 的取值校验很严，未知值原样传会被整条拒绝。"""
    cookie = {**SESSION_COOKIE, "sameSite": "weird", "priority": "Urgent"}

    params = set_cookie_params(cookie, 90, now=NOW)

    assert "sameSite" not in params
    assert "priority" not in params


# ===== 失败与幂等 =====


def test_single_failure_does_not_stop_the_rest():
    other = {**SESSION_COOKIE, "name": "sid2", "value": "def"}
    client = FakeCookieClient([SESSION_COOKIE, other], raise_for=("sid",))

    report = promote_session_cookies(client, 90, now=NOW)

    assert report.failed == 1
    assert report.promoted == 1
    assert [params["name"] for params in client.set_cookies()] == ["sid", "sid2"]


def test_rejected_write_is_counted_as_failure_not_success():
    client = FakeCookieClient([SESSION_COOKIE], reject=("sid",))

    report = promote_session_cookies(client, 90, now=NOW)

    assert report.failed == 1
    assert report.promoted == 0


def test_get_cookies_failure_never_raises():
    client = FakeCookieClient(get_cookies_error=RuntimeError("no cdp"))

    report = promote_session_cookies(client, 90, now=NOW)

    assert report.promoted == 0
    assert report.error == "RuntimeError"


def test_the_same_cookie_is_written_only_once():
    seen: set[tuple[str, str, str]] = set()
    client = FakeCookieClient([SESSION_COOKIE])

    first = promote_session_cookies(client, 90, now=NOW, seen=seen)
    second = promote_session_cookies(client, 90, now=NOW + 60, seen=seen)

    assert first.promoted == 1
    assert second.promoted == 0
    assert second.skipped_seen == 1
    assert client.methods().count("Network.setCookie") == 1


def test_a_changed_value_is_promoted_again():
    """用户重新登录过 → 值变了 → 这是一条新 Cookie，必须再续一次。"""
    seen: set[tuple[str, str, str]] = set()
    promote_session_cookies(FakeCookieClient([SESSION_COOKIE]), 90, now=NOW, seen=seen)
    relogged = {**SESSION_COOKIE, "value": "new-token"}
    client = FakeCookieClient([relogged])

    report = promote_session_cookies(client, 90, now=NOW, seen=seen)

    assert report.promoted == 1
    assert cookie_key(relogged)[2] == "new-token"


# ===== 生命周期挂钩 =====


class FakeProcess:
    def __init__(self, pid: int = 4321) -> None:
        self.pid = pid
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        # 模拟"收到 Browser.close 就自己退了"，避免真等 3 秒的优雅退出预算。
        self.returncode = 0
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


class FakePopen:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.processes: list[FakeProcess] = []

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        process = FakeProcess()
        self.processes.append(process)
        return process


def _transport(popen: FakePopen) -> httpx.MockTransport:
    """调试端口是否应答**跟着假进程的存活走**（真实浏览器一退出端口就没了）。

    不能让假端点永远返回 200：那样 ``is_active()`` 一开始就是真，``start()`` 直接短路，
    进程句柄根本不会被创建——``stop()`` 的三段式关闭也就不会跑，顺序断言会假绿。
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/json/version":
            return httpx.Response(404)
        last = popen.processes[-1] if popen.processes else None
        answering = last is not None and last.returncode is None
        return httpx.Response(
            200 if answering else 503, json={"Browser": "Chrome"} if answering else {}
        )

    return httpx.MockTransport(handler)


def _manager(tmp_path: Path, *, client: FakeCookieClient, hooks: list[Any]) -> BrowserManager:
    exe = tmp_path / "chrome.exe"
    exe.write_text("")
    popen = FakePopen()
    manager = BrowserManager(
        profile_dir=tmp_path / "profile",
        port=9333,
        browser_path=exe,
        popen=popen,
        http_transport=_transport(popen),
        client_factory=lambda *args, **kwargs: client,
        ready_timeout=0.3,
        ready_poll_interval=0.01,
    )
    manager.set_hooks(tuple(hooks))
    return manager


def test_stop_order_is_stop_thread_then_promote_then_browser_close(tmp_path):
    """关闭顺序断言：停线程 → 最后一次续期 → Browser.close。

    续期排在 Browser.close 之后 = 端口已关、CDP 发不出去，真机上表现为"最后那批会话
    Cookie 没被续上"；只断言"有没有续期"是看不出来的。
    """
    events: list[str] = []
    client = FakeCookieClient([SESSION_COOKIE], events=events)
    keepalive = SessionCookieKeepalive(policy=lambda: SessionCookiePolicy(), interval_seconds=60)
    # 挂钩自己的事件与 CDP 事件写进同一张表，顺序才可比。
    keepalive.events = events
    manager = _manager(tmp_path, client=client, hooks=[keepalive])
    manager.start()

    manager.stop()

    assert events.index("stop-thread") < events.index("Storage.getCookies")
    assert events.index("Network.setCookie") < events.index("Browser.close")


def test_thread_is_not_running_after_stop(tmp_path):
    events: list[str] = []
    client = FakeCookieClient([SESSION_COOKIE], events=events)
    keepalive = SessionCookieKeepalive(policy=lambda: SessionCookiePolicy(), interval_seconds=60)
    keepalive.events = events
    manager = _manager(tmp_path, client=client, hooks=[keepalive])
    manager.start()
    assert keepalive.running is True

    manager.stop()

    assert keepalive.running is False


def test_disabled_policy_makes_zero_cdp_calls():
    client = FakeCookieClient([SESSION_COOKIE])
    keepalive = SessionCookieKeepalive(
        policy=lambda: SessionCookiePolicy(enabled=False), interval_seconds=60
    )

    report = keepalive.scan_once(manager=object())

    assert report.promoted == 0
    assert client.calls == []  # 一个 CDP 客户端都不该被创建
    assert keepalive.running is False


def test_disabled_policy_does_not_start_a_thread():
    keepalive = SessionCookieKeepalive(
        policy=lambda: SessionCookiePolicy(enabled=False), interval_seconds=60
    )

    keepalive.on_running(manager=object())

    assert keepalive.running is False
    assert "disabled" in keepalive.events


def test_policy_days_are_normalized_to_the_allowed_set():
    assert SessionCookiePolicy(days=90).normalized_days() == 90
    assert SessionCookiePolicy(days=7).normalized_days() == 90
    assert SessionCookiePolicy(days=365).normalized_days() == 365


def test_keepalive_survives_a_broken_policy_reader(tmp_path):
    def _boom() -> SessionCookiePolicy:
        raise RuntimeError("db gone")

    events: list[str] = []
    client = FakeCookieClient([SESSION_COOKIE], events=events)
    keepalive = SessionCookieKeepalive(policy=_boom, interval_seconds=60)
    keepalive.events = events
    manager = _manager(tmp_path, client=client, hooks=[keepalive])
    manager.start()

    manager.stop()  # 读设置炸了也不能让关闭流程中断

    assert "Browser.close" in events


def test_trace_is_serializable_for_the_evidence_file():
    """证据文件（evidence/T1/cookie-unit-trace.json）用的就是这份结构。"""
    client = FakeCookieClient([SESSION_COOKIE, PARTITIONED_COOKIE])

    report = promote_session_cookies(client, 90, now=NOW)

    trace = json.dumps(
        {
            "getCookies": {"input": len(client.cookies)},
            "setCookie": client.set_cookies(),
            "report": report.as_dict(),
        },
        ensure_ascii=False,
    )
    assert '"p_sid"' in trace
    assert report.promoted == 2


@pytest.mark.parametrize("days", [30, 90, 365])
def test_every_allowed_day_count_maps_to_a_positive_expiry(days: int):
    params = set_cookie_params(SESSION_COOKIE, days, now=NOW)

    assert params["expires"] == int(NOW + days * 86400)
    assert params["expires"] > 0
