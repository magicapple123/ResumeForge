# SPDX-License-Identifier: Apache-2.0
"""B2 切换迁移（T1）：导出 / 注入的属性保真 + **调用顺序**。

顺序是这张卡最容易写错的地方：先关旧后导出 → 导不出来；先导航后注入 → 站点已经把你
重定向到登录页。两种错法在界面上都只表现为"迁移好像没生效"，所以用 ``steps`` 断言。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.browser.cdp_client import CdpClient
from app.services.browser.cookie_migration import (
    MIGRATION_COPIED,
    MIGRATION_FAILED,
    MIGRATION_FAILED_MESSAGE,
    MIGRATION_NOT_NEEDED,
    CookieMigrationError,
    cookie_transfer_params,
    export_all_cookies,
    inject_cookies,
    migrate_cookies_to_new_manager,
)

CHROME_DIR = Path("/data/browser-profile/chrome")
EDGE_DIR = Path("/data/browser-profile/edge")

COOKIES: list[dict[str, Any]] = [
    {
        "name": "sid",
        "value": "abc",
        "domain": ".moka.com",
        "path": "/",
        "expires": -1,
        "session": True,
        "secure": True,
        "httpOnly": True,
        "sameSite": "Lax",
        "priority": "Medium",
    },
    {
        "name": "__Host-rf",
        "value": "host",
        "domain": "moka.com",
        "path": "/",
        "expires": 1_800_000_000,
        "session": False,
        "secure": True,
    },
    {
        "name": "p_cookie",
        "value": "part",
        "domain": "zhipin.com",
        "path": "/",
        "expires": -1,
        "session": True,
        "partitionKey": {"topLevelSite": "https://zhipin.com", "hasCrossSiteAncestor": False},
    },
]


class FakeClient(CdpClient):
    def __init__(self, cookies: list[dict[str, Any]] | None = None, *, reject: bool = False):
        self.cookies = list(COOKIES if cookies is None else cookies)
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.reject = reject
        self.closed = False

    def list_targets(self) -> list[dict[str, Any]]:
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "t"

    def evaluate(self, expression: str, *, timeout: float | None = None) -> Any:
        return None

    def send(
        self, method: str, params: dict[str, Any] | None = None, *, timeout: float | None = None
    ) -> dict[str, Any]:
        self.calls.append((method, dict(params or {})))
        if method == "Storage.getCookies":
            return {"cookies": self.cookies}
        if method == "Network.setCookie":
            return {"success": False} if self.reject else {"success": True}
        return {}

    def close(self) -> None:
        self.closed = True

    def injected(self) -> list[dict[str, Any]]:
        return [params for method, params in self.calls if method == "Network.setCookie"]


class FakeManager:
    """足够像 ``BrowserManager`` 的替身：只记录被调用的顺序。"""

    def __init__(
        self,
        *,
        profile_dir: Path,
        running: bool = True,
        start_error: BaseException | None = None,
        cookies: list[dict[str, Any]] | None = None,
        reject: bool = False,
        log: list[str] | None = None,
    ) -> None:
        self.profile_dir = profile_dir
        self.running = running
        self.start_error = start_error
        self.client_obj = FakeClient(cookies, reject=reject)
        self.log = log if log is not None else []
        self.started = 0
        self.stopped = 0

    def is_running(self) -> bool:
        return self.running

    def client(self) -> FakeClient:
        self.log.append(f"client:{self.profile_dir.name}")
        return self.client_obj

    def client_for_target(self, target_id: str) -> FakeClient:  # pragma: no cover - 未用
        return self.client_obj

    def start(self, url: str | None = None) -> None:
        self.log.append(f"start:{self.profile_dir.name}")
        if self.start_error is not None:
            raise self.start_error
        self.started += 1
        self.running = True

    def stop(self) -> None:
        self.log.append(f"stop:{self.profile_dir.name}")
        self.stopped += 1
        self.running = False


# ===== 属性保真 =====


def test_export_reads_every_cookie_not_only_session_ones():
    client = FakeClient()

    exported = export_all_cookies(client)

    assert len(exported) == len(COOKIES)
    assert client.calls == [("Storage.getCookies", {})]


def test_export_failure_is_raised_so_migration_can_report_it():
    class Boom(FakeClient):
        def send(self, method, params=None, *, timeout=None):  # noqa: ARG002
            raise RuntimeError("cdp down")

    try:
        export_all_cookies(Boom())
    except CookieMigrationError as exc:
        assert "RuntimeError" in str(exc)
    else:  # pragma: no cover - 没抛就是回归
        raise AssertionError("读不到 Cookie 必须显式失败")


def test_injection_preserves_session_cookies_as_session_cookies():
    client = FakeClient()

    report = inject_cookies(client, COOKIES)

    assert report.injected == len(COOKIES)
    session = next(item for item in client.injected() if item["name"] == "sid")
    # 迁移不改变"是不是会话 Cookie"——L1 之后会把它续成持久 Cookie。
    assert session["expires"] == -1


def test_injection_preserves_the_original_expiry_of_persistent_cookies():
    params = cookie_transfer_params(COOKIES[1])

    assert params["expires"] == 1_800_000_000
    # __Host- 三条件：无 domain、path=/、secure。
    assert "domain" not in params
    assert params["path"] == "/"
    assert params["secure"] is True
    assert params["url"] == "https://moka.com/"


def test_injection_preserves_partition_key():
    params = cookie_transfer_params(COOKIES[2])

    assert params["partitionKey"] == COOKIES[2]["partitionKey"]


def test_single_injection_failure_does_not_stop_the_rest():
    client = FakeClient(reject=True)

    report = inject_cookies(client, COOKIES)

    assert report.total == len(COOKIES)
    assert report.failed == len(COOKIES)
    assert report.injected == 0


# ===== 顺序 =====


def test_export_happens_before_the_old_instance_is_stopped():
    log: list[str] = []
    old = FakeManager(profile_dir=CHROME_DIR, log=log)
    new = FakeManager(profile_dir=EDGE_DIR, running=False, log=log)

    outcome = migrate_cookies_to_new_manager(old, new)

    assert outcome.status == MIGRATION_COPIED
    assert outcome.steps == ("export-running", "stop-previous", "start-current", "inject")
    # 关键不变量：导出发生在停旧之前（停了就再也发不出 Storage.getCookies）。
    assert log.index("client:chrome") < log.index("stop:chrome")
    assert outcome.cookie_count == len(COOKIES)
    assert outcome.injected == len(COOKIES)


def test_new_instance_is_started_before_injection():
    log: list[str] = []
    old = FakeManager(profile_dir=CHROME_DIR, log=log)
    new = FakeManager(profile_dir=EDGE_DIR, running=False, log=log)

    migrate_cookies_to_new_manager(old, new)

    # 注入必须在新实例起来之后（要拿到新 profile 的连接），且新实例启动时 url=None
    # ⇒ 还没有导航，注入落在"首次导航前"。
    assert new.started == 1
    assert log.index("start:edge") < log.index("client:edge")


def test_a_stopped_old_browser_is_started_once_to_export():
    log: list[str] = []
    old = FakeManager(profile_dir=CHROME_DIR, running=False, log=log)
    new = FakeManager(profile_dir=EDGE_DIR, running=False, log=log)

    outcome = migrate_cookies_to_new_manager(old, new)

    assert outcome.source == "restarted"
    assert outcome.steps[:2] == ("start-previous", "export-restarted")
    assert old.started == 1


def test_same_identity_only_stops_the_old_instance():
    """同一浏览器重复启动**不触发**迁移。"""
    log: list[str] = []
    old = FakeManager(profile_dir=CHROME_DIR, log=log)
    new = FakeManager(profile_dir=CHROME_DIR, running=False, log=log)

    outcome = migrate_cookies_to_new_manager(old, new)

    assert outcome.status == MIGRATION_NOT_NEEDED
    assert outcome.steps == ("stop-previous",)
    assert old.client_obj.calls == []  # 一条 CDP 都没发
    assert new.started == 0


def test_old_browser_start_failure_is_explicit_and_keeps_the_old_profile(tmp_path):
    """旧浏览器打不开 → 明确失败，且旧 profile 一个字节都没动。"""
    old_profile = tmp_path / "browser-profile" / "chrome"
    old_profile.mkdir(parents=True)
    (old_profile / "Local State").write_text("keep-me")
    log: list[str] = []
    old = FakeManager(
        profile_dir=old_profile, running=False, start_error=RuntimeError("gone"), log=log
    )
    new = FakeManager(profile_dir=EDGE_DIR, running=False, log=log)

    outcome = migrate_cookies_to_new_manager(old, new)

    assert outcome.status == MIGRATION_FAILED
    assert outcome.message == MIGRATION_FAILED_MESSAGE
    assert "export-failed" in outcome.steps
    assert new.started == 0  # 不静默继续：新实例不会被悄悄拉起来
    assert (old_profile / "Local State").read_text() == "keep-me"


def test_new_browser_start_failure_reports_a_migration_failure():
    old = FakeManager(profile_dir=CHROME_DIR)
    new = FakeManager(profile_dir=EDGE_DIR, running=False, start_error=RuntimeError("blocked"))

    outcome = migrate_cookies_to_new_manager(old, new)

    assert outcome.status == MIGRATION_FAILED
    assert outcome.cookie_count == len(COOKIES)
    assert outcome.steps[-1] == "inject-failed"


def test_outcome_is_serializable_for_evidence():
    old = FakeManager(profile_dir=CHROME_DIR)
    new = FakeManager(profile_dir=EDGE_DIR, running=False)

    outcome = migrate_cookies_to_new_manager(old, new)

    payload = outcome.as_dict()
    assert payload["steps"] == [
        "export-running",
        "stop-previous",
        "start-current",
        "inject",
    ]
    assert "status=copied" in outcome.as_line()
