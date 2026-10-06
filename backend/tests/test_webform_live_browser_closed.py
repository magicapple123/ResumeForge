"""浏览器被关掉后，实时填表会话自动结束。

从 test_webform_live.py 拆出（该文件的行数豁免有 >600 行的书面触发条件，本主题独立
成文件避免再顶破预算）。钉住四件事：连续失败 + 浏览器级确认 → 自动结束并带原因；
浏览器还活着（标签页没了）时不误判；单轮失败（页面跳转）绝不触发；自动结束之后再
手动 stop 幂等。FakeLiveClient 留在 test_webform_live.py。
"""
import time

import pytest
from app.services.webform import live as live_module
from app.services.webform.live import LiveSession
from test_webform_live import FakeLiveClient


def test_browser_closed_after_consecutive_failures_auto_stops(monkeypatch):
    """浏览器整个被关掉：WebSocket 连续失败达到阈值、且浏览器级端点也不可达，
    会话要自动结束并在状态里带上原因——不能永远显示「运行中」等用户手动停。"""
    monkeypatch.setattr(live_module, "POLL_INTERVAL_SECONDS", 0.01)

    class BrowserGone(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            self.expressions.append(expression)
            if "rf:live-state" in expression:
                raise RuntimeError("connection gone")
            return super().evaluate(expression, timeout=timeout)

        def list_targets(self):
            raise RuntimeError("connection refused")

    client = BrowserGone()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        deadline = time.monotonic() + 2.0
        while session.is_running and time.monotonic() < deadline:
            time.sleep(0.02)
        assert session.is_running is False
        assert session.state["running"] is False
        assert session.state["stop_reason"] == "browser_closed"
    finally:
        # 自动结束之后用户再点手动停止必须幂等：不得报错，状态保持已结束。
        session.stop()
    assert session.is_running is False
    assert session.state["running"] is False


def test_failures_with_the_browser_still_alive_do_not_auto_stop(monkeypatch):
    """只是标签页没了 / 页面跳转（浏览器级端点正常应答）时，失败再多次也不结束会话。

    阈值判定必须配合浏览器级确认：把「关一个标签页」误判成「关浏览器」，多标签模式下
    每个被关掉的页面都会把整场会话带走。
    """
    monkeypatch.setattr(live_module, "POLL_INTERVAL_SECONDS", 0.01)

    class TabGone(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            self.expressions.append(expression)
            if "rf:live-state" in expression:
                raise RuntimeError("target closed")
            return super().evaluate(expression, timeout=timeout)

        # list_targets 刻意不覆盖：浏览器级端点照常应答 = 浏览器还活着。

    client = TabGone()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        time.sleep(0.3)
        assert session.is_running is True
        assert session.state["stop_reason"] == ""
    finally:
        session.stop()


def test_a_single_tick_failure_never_triggers_the_auto_stop():
    """页面跳转这类**单轮**失败绝不能触发自动结束（钉住既有行为不回退）。"""

    class Exploding(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            self.expressions.append(expression)
            if "rf:live-state" in expression:
                raise RuntimeError("navigation")
            return super().evaluate(expression, timeout=timeout)

    client = Exploding()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        with pytest.raises(RuntimeError):
            session._tick()
        assert session.is_running is True
        assert session.state["stop_reason"] == ""
    finally:
        session.stop()


def test_multi_session_auto_stops_when_the_browser_sync_fails(monkeypatch):
    """多标签会话：标签页同步（走浏览器调试端口）连续失败 → 整个会话自动结束并带原因。"""
    from app.services.webform.live_multi import BROWSER_CLOSED_SYNC_FAILURES, MultiLiveSession

    monkeypatch.setattr(live_module, "POLL_INTERVAL_SECONDS", 0.01)

    def gone_loader():
        raise RuntimeError("connection refused")

    session = MultiLiveSession(
        FakeLiveClient(), {"name": "张三"}, target_clients_loader=gone_loader
    )
    session.start()
    try:
        deadline = time.monotonic() + 2.0
        while session.is_running and time.monotonic() < deadline:
            time.sleep(0.02)
        assert session.is_running is False
        assert session.state["running"] is False
        assert session.state["stop_reason"] == "browser_closed"
        # 状态查询（经 _active_state）在标签页会话全部收掉后仍要带上结束原因。
        assert session._active_state()["stop_reason"] == "browser_closed"
        assert session._active_state()["running"] is False
    finally:
        session.stop()
    assert BROWSER_CLOSED_SYNC_FAILURES == 2
