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
from test_webform_live import FakeLiveClient


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


@pytest.mark.parametrize(
    ("interval", "ticks"), [(IDLE_POLL_INTERVAL_SECONDS, 8)], ids=["constants"]
)
def test_backoff_constants_are_wired_into_exports(interval: float, ticks: int) -> None:
    """常量在 __all__ 里（外部/测试可导入），防止改名后测试静默失联。"""
    from app.services.webform import live as live_module

    assert interval == live_module.IDLE_POLL_INTERVAL_SECONDS
    assert ticks == live_module.IDLE_AFTER_QUIET_TICKS
