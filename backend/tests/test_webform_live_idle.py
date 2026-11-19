# SPDX-License-Identifier: Apache-2.0
"""实时会话的空闲退避：连续空轮拉长间隔，任何事件立即回快档。

从 test_webform_live.py 主题拆分惯例独立成文（2026-10-05 性能审查 item 10 的
行为钉子）：_loop 的间隔决策只在轮询线程里发生，真机跑起来难以观察，这里直接
驱动 ``_loop`` 把每轮 ``wait`` 的秒数录下来断言。
"""

from __future__ import annotations

import pytest
from app.services.webform.live import (
    IDLE_AFTER_QUIET_TICKS,
    IDLE_POLL_INTERVAL_SECONDS,
    POLL_INTERVAL_SECONDS,
    LiveSession,
)
from test_webform_live import FakeLiveClient, raw_control


def _record_delays(monkeypatch, tick_results: list[bool]) -> list[float]:
    """直接驱动 _loop：_tick 按脚本出牌，wait 记下每轮间隔、凑够轮数后自动停。"""
    session = LiveSession(FakeLiveClient(), {"name": "张三"})
    delays: list[float] = []
    ticks = iter(tick_results)
    monkeypatch.setattr(session, "_tick", lambda: next(ticks))

    def fake_wait(seconds: float) -> bool:
        delays.append(seconds)
        if len(delays) >= len(tick_results):
            session._stop.set()
        return True

    monkeypatch.setattr(session._stop, "wait", fake_wait)
    session._loop()
    return delays


def test_quiet_ticks_stretch_interval_to_idle(monkeypatch: pytest.MonkeyPatch) -> None:
    """连续空轮：前 IDLE_AFTER_QUIET_TICKS-1 轮保持快档，之后进慢档。"""
    quiet_rounds = IDLE_AFTER_QUIET_TICKS + 3
    delays = _record_delays(monkeypatch, [False] * quiet_rounds)
    assert len(delays) == quiet_rounds
    assert delays[: IDLE_AFTER_QUIET_TICKS - 1] == [POLL_INTERVAL_SECONDS] * (
        IDLE_AFTER_QUIET_TICKS - 1
    )
    assert delays[IDLE_AFTER_QUIET_TICKS - 1 :] == [IDLE_POLL_INTERVAL_SECONDS] * (
        quiet_rounds - IDLE_AFTER_QUIET_TICKS + 1
    )


def test_any_event_restores_fast_interval_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    """慢档中一旦有事件（焦点/请求/跳转），下一轮立刻回快档。"""
    delays = _record_delays(monkeypatch, [False] * (IDLE_AFTER_QUIET_TICKS + 2) + [True, False])
    assert delays[IDLE_AFTER_QUIET_TICKS + 1] == IDLE_POLL_INTERVAL_SECONDS
    assert delays[IDLE_AFTER_QUIET_TICKS + 2] == POLL_INTERVAL_SECONDS


def test_error_keeps_fast_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    """单轮出错保持快档（连接恢复、页面跳转要尽快跟上），单次失败不触发自动结束。"""
    session = LiveSession(FakeLiveClient(), {"name": "张三"})
    delays: list[float] = []
    calls = {"n": 0}

    def flaky_tick() -> bool:
        calls["n"] += 1
        if calls["n"] == IDLE_AFTER_QUIET_TICKS + 1:
            raise RuntimeError("页面跳转瞬间的一次失败")
        return False

    monkeypatch.setattr(session, "_tick", flaky_tick)

    def fake_wait(seconds: float) -> bool:
        delays.append(seconds)
        if len(delays) >= IDLE_AFTER_QUIET_TICKS + 2:
            session._stop.set()
        return True

    monkeypatch.setattr(session._stop, "wait", fake_wait)
    session._loop()
    assert delays[IDLE_AFTER_QUIET_TICKS] == POLL_INTERVAL_SECONDS
    assert delays[IDLE_AFTER_QUIET_TICKS + 1] == POLL_INTERVAL_SECONDS


def test_visible_panel_never_falls_into_the_idle_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """**面板开着就不算空闲**：用户正盯着它，随时会点「填入 / 换个资料 / 切范围」。

    实测的反馈就出在这里：面板开着、用户去点范围开关时，轮询正好处在 1.5s 慢档——
    点下去之后要等一秒半才有任何变化，看起来就是"点了没反应"。判据是页面状态里的
    ``control``（``__rfFocus``）：面板一收起 ``hide()`` 就把它清空，非空即"面板正显示着"。

    这条**只能靠真 ``_tick``**：前几条都 monkeypatch 了 ``_tick``，喂进去的是布尔值，
    根本碰不到"面板可见"这个条件。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    # 让面板"显示着"：焦点落在一个框上，且不消费它（不再 tick 出新的 seq）。
    client.focus_on(raw_control(label="姓名"))
    rounds = IDLE_AFTER_QUIET_TICKS + 2
    delays: list[float] = []

    def fake_wait(seconds: float) -> bool:
        delays.append(seconds)
        if len(delays) >= rounds:
            session._stop.set()
        return True

    monkeypatch.setattr(session._stop, "wait", fake_wait)
    session._loop()

    assert delays == [POLL_INTERVAL_SECONDS] * rounds, (
        f"面板可见时进了慢档：{delays}"
    )


def test_a_hidden_panel_goes_back_to_idle(monkeypatch: pytest.MonkeyPatch) -> None:
    """反面：面板收起（``control`` 为空）后**必须**能回到慢档，否则这条判据等于没有。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    rounds = IDLE_AFTER_QUIET_TICKS + 2
    delays: list[float] = []

    def fake_wait(seconds: float) -> bool:
        delays.append(seconds)
        if len(delays) >= rounds:
            session._stop.set()
        return True

    monkeypatch.setattr(session._stop, "wait", fake_wait)
    session._loop()

    assert delays[-1] == IDLE_POLL_INTERVAL_SECONDS, delays


@pytest.mark.parametrize(
    ("interval", "ticks"), [(IDLE_POLL_INTERVAL_SECONDS, 8)], ids=["constants"]
)
def test_backoff_constants_are_wired_into_exports(interval: float, ticks: int) -> None:
    """常量在 __all__ 里（外部/测试可导入），防止改名后测试静默失联。"""
    from app.services.webform import live as live_module

    assert interval == live_module.IDLE_POLL_INTERVAL_SECONDS
    assert ticks == live_module.IDLE_AFTER_QUIET_TICKS
