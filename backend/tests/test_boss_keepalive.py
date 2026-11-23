# SPDX-License-Identifier: Apache-2.0
"""K2 BOSS 保活（T1）：三道闸门 + 后台标签的 CDP 调用次数。

"保活"会真实访问 zhipin.com，所以每一条闸门都必须有单测：浏览器没运行、还没到期、
设置关了——三种情形下的 CDP 调用次数必须分别是 0 / 0 / 0。这不是性能优化，是
"不对用户没同意的事发起网络请求"。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

import pytest
from app.models.setting import AppSetting
from app.services.browser.boss_keepalive import (
    CAPTCHA_BACKOFF,
    MIN_VISIT_INTERVAL,
    RESULT_CAPTCHA,
    RESULT_ERROR,
    RESULT_LOGIN_REQUIRED,
    RESULT_OK,
    BossKeepalive,
    BossKeepaliveState,
    boss_entry_url,
    classify,
    mark_notice_delivered,
    read_notice,
    read_state,
    visit_once,
    write_enabled,
    write_result,
)
from sqlalchemy.orm import Session

NOW = datetime(2026, 11, 23, 22, 30, 0)

READY_STATE: dict[str, Any] = {
    "url": "https://www.zhipin.com/",
    "ready": "complete",
    "captcha": False,
    "login_required": False,
}


class FakePage:
    def __init__(self, owner: FakeBrowser, target_id: str, state: Any) -> None:
        self.owner = owner
        self.target_id = target_id
        self.state = state

    def evaluate(self, expression: str, *, timeout: float | None = None) -> Any:  # noqa: ARG002
        self.owner.log.append("evaluate")
        if isinstance(self.state, BaseException):
            raise self.state
        return json.dumps(self.state)

    def close(self) -> None:
        self.owner.log.append("page.close")


class FakeBrowserClient:
    def __init__(self, owner: FakeBrowser) -> None:
        self.owner = owner

    def send(
        self, method: str, params: dict[str, Any] | None = None, *, timeout: float | None = None
    ) -> dict[str, Any]:  # noqa: ARG002
        payload = dict(params or {})
        self.owner.calls.append((method, payload))
        if method == "Target.createTarget":
            if self.owner.create_error is not None:
                raise self.owner.create_error
            return {"targetId": "target-1"}
        return {}

    def close(self) -> None:
        self.owner.log.append("client.close")


class FakeBrowser:
    """投递浏览器替身：只要 ``is_running`` / ``client`` / ``client_for_target``。"""

    def __init__(
        self,
        *,
        running: bool = True,
        state: Any = None,
        create_error: BaseException | None = None,
    ) -> None:
        self.running = running
        self.state = READY_STATE if state is None else state
        self.create_error = create_error
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.log: list[str] = []

    def is_running(self) -> bool:
        return self.running

    def client(self) -> FakeBrowserClient:
        self.log.append("client")
        return FakeBrowserClient(self)

    def client_for_target(self, target_id: str) -> FakePage:
        self.log.append(f"page:{target_id}")
        return FakePage(self, target_id, self.state)

    def methods(self) -> list[str]:
        return [method for method, _params in self.calls]


def _keepalive(**overrides: Any) -> BossKeepalive:
    """默认：到期待访问、时间固定、结果写进内存。"""
    written: list[str] = []
    overrides.setdefault("state_reader", lambda: BossKeepaliveState())
    overrides.setdefault("result_writer", written.append)
    overrides.setdefault("clock", lambda: NOW)
    overrides.setdefault("timeout_seconds", 0.2)
    keepalive = BossKeepalive(**overrides)
    keepalive.written = written  # type: ignore[attr-defined] - 断言用
    return keepalive


# ===== 三道闸门：零调用 =====


def test_browser_not_running_makes_zero_calls():
    browser = FakeBrowser(running=False)
    keepalive = _keepalive()

    result = keepalive.check_once(browser)

    assert result == "not-running"
    assert browser.calls == []  # 一个 CDP 命令都没发
    assert browser.log == []  # 连客户端都没创建


def test_recent_success_skips_the_visit():
    browser = FakeBrowser()
    keepalive = _keepalive(
        state_reader=lambda: BossKeepaliveState(
            last_at=(NOW - timedelta(hours=1)).isoformat(timespec="seconds"),
            last_result=RESULT_OK,
        )
    )

    result = keepalive.check_once(browser)

    assert result == "not-due"
    assert browser.calls == []


def test_disabled_setting_makes_zero_calls():
    browser = FakeBrowser()
    keepalive = _keepalive(state_reader=lambda: BossKeepaliveState(enabled=False))

    result = keepalive.check_once(browser)

    assert result == "disabled"
    assert browser.calls == []
    assert browser.log == []


def test_captcha_backs_off_for_three_days():
    browser = FakeBrowser()
    last = NOW - timedelta(days=1)
    keepalive = _keepalive(
        state_reader=lambda: BossKeepaliveState(
            last_at=last.isoformat(timespec="seconds"), last_result=RESULT_CAPTCHA
        )
    )

    assert keepalive.check_once(browser) == "not-due"
    assert browser.calls == []


# ===== 到点后：后台标签访问一次 =====


def test_due_visit_opens_one_background_tab_and_closes_it():
    browser = FakeBrowser()
    keepalive = _keepalive()

    result = keepalive.check_once(browser)

    assert result == RESULT_OK
    assert browser.methods() == ["Target.createTarget", "Target.closeTarget"]
    _method, params = browser.calls[0]
    assert params["background"] is True  # 不抢焦点、不新开窗口
    assert params["url"] == boss_entry_url()
    assert browser.calls[1][1]["targetId"] == "target-1"
    assert keepalive.written == [RESULT_OK]  # type: ignore[attr-defined]


def test_visit_only_loads_the_homepage():
    """只加载首页、不点任何东西：整段逻辑里不许出现点击 / 填表类命令。"""
    browser = FakeBrowser()

    visit_once(browser, timeout_seconds=0.2)

    assert set(browser.methods()) == {"Target.createTarget", "Target.closeTarget"}
    assert browser.calls[0][1]["url"] == "https://www.zhipin.com/"


def test_login_form_visible_means_login_required():
    state = {**READY_STATE, "login_required": True}
    browser = FakeBrowser(state=state)

    assert visit_once(browser, timeout_seconds=0.2) == RESULT_LOGIN_REQUIRED


def test_captcha_wins_over_login_form():
    state = {**READY_STATE, "login_required": True, "captcha": True}
    keepalive = _keepalive()
    browser = FakeBrowser(state=state)

    result = keepalive.check_once(browser)

    assert result == RESULT_CAPTCHA
    assert keepalive.written == [RESULT_CAPTCHA]  # type: ignore[attr-defined]


def test_tab_is_closed_even_when_the_probe_fails():
    browser = FakeBrowser(state=RuntimeError("cdp boom"))

    result = visit_once(browser, timeout_seconds=0.2)

    assert result == RESULT_ERROR
    # 关不掉就是用户窗口里多出一个他没开的页，比"结果没记上"更糟。
    assert "Target.closeTarget" in browser.methods()


def test_unready_page_times_out_into_error():
    browser = FakeBrowser(state={"url": "https://www.zhipin.com/", "ready": "loading"})

    result = visit_once(browser, timeout_seconds=0.05)

    assert result == RESULT_ERROR
    assert "Target.closeTarget" in browser.methods()


def test_create_target_failure_is_recorded_as_error():
    browser = FakeBrowser(create_error=RuntimeError("cdp down"))
    keepalive = _keepalive()

    result = keepalive.check_once(browser)

    assert result == RESULT_ERROR
    assert keepalive.written == [RESULT_ERROR]  # type: ignore[attr-defined]


# ===== 判定与设置 =====


def test_classify_precedence():
    assert classify({}) == RESULT_ERROR
    assert classify({"ready": "complete"}) == RESULT_OK
    assert classify({"login_required": True}) == RESULT_LOGIN_REQUIRED
    assert classify({"captcha": True, "login_required": True}) == RESULT_CAPTCHA


def test_is_due_boundaries():
    fresh = BossKeepaliveState(enabled=True)
    assert fresh.is_due(now=NOW) is True

    exactly_24h = BossKeepaliveState(
        last_at=(NOW - MIN_VISIT_INTERVAL).isoformat(timespec="seconds"), last_result=RESULT_OK
    )
    assert exactly_24h.is_due(now=NOW) is True

    just_under = BossKeepaliveState(
        last_at=(NOW - MIN_VISIT_INTERVAL + timedelta(minutes=1)).isoformat(timespec="seconds"),
        last_result=RESULT_OK,
    )
    assert just_under.is_due(now=NOW) is False

    captcha_window = BossKeepaliveState(
        last_at=(NOW - CAPTCHA_BACKOFF + timedelta(hours=1)).isoformat(timespec="seconds"),
        last_result=RESULT_CAPTCHA,
    )
    assert captcha_window.is_due(now=NOW) is False


def test_disabled_state_is_never_due():
    assert BossKeepaliveState(enabled=False).is_due(now=NOW) is False


def test_unparsable_last_at_is_treated_as_never_visited():
    state = BossKeepaliveState(last_at="not-a-date", last_result=RESULT_OK)

    assert state.is_due(now=NOW) is True


def test_settings_roundtrip_in_the_database(db_session: Session):
    """默认开、从没访问过；写一次结果后读回来是同一份事实。"""
    assert read_state(db_session).enabled is True
    assert read_state(db_session).last_at == ""

    write_result(db_session, RESULT_OK, now=NOW)
    state = read_state(db_session)
    assert state.last_result == RESULT_OK
    assert state.last_at.startswith("2026-11-23T22:30")

    write_enabled(db_session, False)
    assert read_state(db_session).enabled is False


def test_unknown_result_value_is_rejected(db_session: Session):
    with pytest.raises(ValueError, match="未知的保活结果"):
        write_result(db_session, "maybe")


def test_notice_is_delivered_only_once(db_session: Session):
    assert read_notice(db_session) == ""
    db_session.add(AppSetting(key="apply.boss_keepalive.notice", value="2026-11-23T22:30:00"))
    db_session.commit()

    assert read_notice(db_session) == "2026-11-23T22:30:00"
    assert mark_notice_delivered(db_session) is True
    assert mark_notice_delivered(db_session) is False


def test_disabled_setting_never_starts_a_thread():
    keepalive = _keepalive(state_reader=lambda: BossKeepaliveState(enabled=False))

    keepalive.on_running(FakeBrowser())

    assert keepalive.running is False
    assert "disabled" in keepalive.events


def test_three_scenarios_call_counts():
    """证据文件 boss-keepalive-calls.txt 用的就是这三个数：0 / 0 / 2。"""
    not_running = FakeBrowser(running=False)
    not_due = FakeBrowser()
    due = FakeBrowser()
    counts = {
        "not-running": (
            _keepalive().check_once(not_running),
            len(not_running.calls),
        ),
        "not-due": (
            _keepalive(
                state_reader=lambda: BossKeepaliveState(
                    last_at=(NOW - timedelta(hours=2)).isoformat(timespec="seconds"),
                    last_result=RESULT_OK,
                )
            ).check_once(not_due),
            len(not_due.calls),
        ),
        "due": (_keepalive().check_once(due), len(due.calls)),
    }

    assert counts["not-running"] == ("not-running", 0)
    assert counts["not-due"] == ("not-due", 0)
    assert counts["due"] == (RESULT_OK, 2)
