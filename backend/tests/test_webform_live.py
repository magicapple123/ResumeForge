"""「点哪个填哪个」：单控件建议与轮询会话。

这个模式与批量模式共用同一套匹配器、同一套"永不自动填"判据、同一套写入与回读校验——
测试的重点因此有两头：**单控件判定要对**，以及**它真的复用了那条路径**（而不是自己又写了
一份"填一个框"的实现）。

（拆分说明：自动填充游标与单控件判定在 test_webform_live_session.py；AI 兜底在
test_webform_live_ai.py；「记住这条」在 test_webform_live_remember.py；「问投投」在
test_webform_live_assistant_ask.py。FakeLiveClient/raw_control 留在本文件供各主题文件复用。）
"""
import json
import re

import pytest

from app.services.browser.cdp_client import CdpClient
from app.services.webform import live as live_module
from app.services.webform.live import LiveSession, is_live_running, live_status, start_live, stop_live


class FakeLiveClient(CdpClient):
    """按脚本标记分派的假客户端；带一点状态，够跑完"聚焦 → 建议 → 接受 → 写入"一整轮。"""

    def __init__(self):
        self.installed = False
        self.seq = 0
        self.focus: dict | None = None
        self.accept: dict | None = None
        self.remember: dict | None = None
        self.panels: list[dict] = []
        self.written = ""
        self.expressions: list[str] = []

    def list_targets(self):
        return []

    def new_tab(self, url="about:blank"):
        return "TAB"

    def send(self, method, params=None, *, timeout=None):
        return {}

    def set_file_input(self, selector, files, *, timeout=None):
        pass

    def close(self):
        pass

    def evaluate(self, expression, *, timeout=None):
        self.expressions.append(expression)
        if "rf:live-listener" in expression:
            self.installed = True
            return '{"ok": true}'
        if "rf:live-uninstall" in expression:
            self.installed = False
            self.focus = None
            return "1"
        if "rf:live-state" in expression:
            return json.dumps(
                {
                    "seq": self.seq,
                    "control": self.focus,
                    "accept": self.accept,
                    "remember": self.remember,
                    "installed": self.installed,
                }
            )
        if "rf:live-panel" in expression:
            start = expression.index("window.__rfShowPanel(") + len("window.__rfShowPanel(")
            end = expression.index(");", start)          # 面板载荷到此为止
            self.panels.append(json.loads(expression[start:end]))
            return "1"
        # 这一条**必须排在 `rf:live-hide` 前面**：`"rf:live-hide" in "rf:live-hide-remember"`
        # 是真的，排后面的话「记住这条」的回执会被当成「填入」的回执、把 accept 也清掉。
        if "rf:live-hide-remember" in expression:
            self.remember = None
            return "1"
        if "rf:live-hide" in expression:
            self.accept = None
            return "1"
        if "rf:set-value" in expression:
            # 如实记住写进去的值——回读时要原样吐回来，否则会被（正确地）判成"未确认"。
            match = re.search(r"setter\.call\(el, (\".*?\")\);", expression)
            self.written = json.loads(match.group(1)) if match else ""
            return '{"ok": true, "value": %s}' % json.dumps(self.written, ensure_ascii=False)
        if "rf:read-back" in expression:
            return '{"ok": true, "value": %s}' % json.dumps(self.written, ensure_ascii=False)
        return None

    def focus_on(self, control: dict) -> None:
        self.focus = control
        self.seq += 1

    def remember_on(self, control: dict, value: str, *, label: str = "") -> None:
        """模拟用户点了面板上的「记住这条」——与 ``accept`` 是两个独立全局。"""
        self.remember = {
            "label": label or str(control.get("label") or ""),
            "value": value,
            "control": control,
            "selector": control.get("selector") or "",
        }


def raw_control(**overrides) -> dict:
    base = {
        "index": 0,
        "type": "text",
        "name": "",
        "label": "姓名",
        "placeholder": "",
        "aria_label": "",
        "required": False,
        "selector": '[data-rf-focus="1"]',
        "options": [],
        "nearby_text": "",
        "group": "",
        "value": "",
        "display": "",
        "checked": False,
    }
    base.update(overrides)
    return base


# ===== 会话 =====


def test_starting_installs_the_listener_and_stopping_removes_it():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})

    session.start()
    assert client.installed is True
    assert session.is_running is True

    session.stop()
    assert client.installed is False
    assert session.is_running is False


def test_focusing_a_field_produces_a_panel_with_the_matching_value():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()

        assert client.panels[-1]["status"] == "matched"
        assert client.panels[-1]["value"] == "张三"
        assert client.panels[-1]["field_label"] == "姓名"
    finally:
        session.stop()


def test_the_panel_payload_carries_the_related_picks():
    """「可能是这几个」**跟着每一帧推送走**——命中 / 认不出 / AI 在想，那几个分支都会用到它。

    漏一帧那一栏就会空掉，而空掉的样子（整块不显示）与"确实没挑出来"**长得一模一样**，
    所以只有这条断言能区分。
    """
    client = FakeLiveClient()
    catalog = [{"group": "联系方式", "label": "当前所处地", "value": "天津", "key": "city"}]
    session = LiveSession(client, {"city": "天津"}, catalog)
    session.start()
    try:
        client.focus_on(raw_control(label="当前所处地"))
        session._tick()

        assert client.panels[-1]["status"] == "matched"
        assert [item["label"] for item in client.panels[-1]["related"]] == ["当前所处地"]
        assert [item["label"] for item in session.state["related"]] == ["当前所处地"]
    finally:
        session.stop()


def test_focusing_a_user_choice_control_clears_the_related_picks_too():
    """焦点离开可填控件时，推荐栏也要清掉——否则它挂在下一个框上指错方向。"""
    client = FakeLiveClient()
    catalog = [{"group": "联系方式", "label": "当前所处地", "value": "天津", "key": "city"}]
    session = LiveSession(client, {"city": "天津"}, catalog)
    session.start()
    try:
        client.focus_on(raw_control(label="当前所处地"))
        session._tick()
        assert session.state["related"], "前提不成立：上一帧就没有推荐"

        client.focus = None
        client.seq += 1
        session._tick()

        assert session.state["related"] == []
    finally:
        session.stop()


def test_focusing_a_user_choice_control_clears_the_panel():
    """焦点落到**不填**的控件上（单选/复选/下拉/附件）时，面板要清掉。

    注入脚本遇到这类控件会收掉面板并把焦点序号 +1，**但不带控件描述**——这里接住那个
    信号。"序号变了 + 没有控件"就是"用户点到了一个不填的框"。

    不清的话：浏览器里面板已经收了，而 ResumeForge 页面上还挂着上一条"将填入：姓名=张三"，
    两边对不上；用户回到浏览器看见的又是一片空白，只会以为程序卡住了。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        assert session.state["status"] == "matched"

        # 用户点到了一个单选框：页面侧 `__rfFocus` 被清成 null、序号 +1。
        client.focus = None
        client.seq += 1
        session._tick()

        assert session.state["status"] == ""
        assert session.state["field_label"] == ""
        assert session.state["value"] == ""
        assert session.state["note"] == ""
    finally:
        session.stop()


def test_the_same_field_is_not_recomputed_on_every_poll():
    """轮询每 350ms 一次；只有焦点真的变了才重算，否则会把页面刷爆。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        first = len(client.panels)

        session._tick()
        session._tick()

        assert len(client.panels) == first, "焦点没变却又算了一遍"
    finally:
        session.stop()


def test_accepting_writes_through_the_same_path_as_the_bulk_mode():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        client.accept = {"value": "张三"}
        session._tick()

        # 走的是 service.apply_fill：同样的哑执行器 + 回读校验。
        joined = "\n".join(client.expressions)
        assert "rf:set-value" in joined
        assert "rf:read-back" in joined
        assert client.panels[-1]["status"] == "filled"
        assert session.state["filled"] == 1
    finally:
        session.stop()


def test_a_failed_write_is_reported_rather_than_claimed_as_done():
    class ReadbackMismatch(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            if "rf:read-back" in expression:
                self.expressions.append(expression)
                return '{"ok": true, "value": "别的东西"}'
            return super().evaluate(expression, timeout=timeout)

    client = ReadbackMismatch()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        client.accept = {"value": "张三"}
        session._tick()

        assert client.panels[-1]["status"] == "blocked"
        assert session.state["status"] == "failed"
        assert session.state["filled"] == 0
    finally:
        session.stop()


def test_the_accept_flag_is_cleared_so_a_click_is_not_replayed():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        client.accept = {"value": "张三"}
        session._tick()
        filled_once = session.state["filled"]

        session._tick()

        assert session.state["filled"] == filled_once, "同一次点击被重复执行了"
    finally:
        session.stop()


# ===== 单例 =====


def test_only_one_session_can_run_at_a_time():
    client = FakeLiveClient()
    try:
        first = start_live(client, {"name": "张三"})
        second = start_live(client, {"name": "张三"})
        assert first is second
        assert is_live_running() is True
        assert live_status()["running"] is True
    finally:
        stop_live()
    assert is_live_running() is False
    assert live_status()["running"] is False


def test_stop_is_safe_when_nothing_is_running():
    stop_live()
    stop_live()
    assert is_live_running() is False


def test_the_poller_survives_a_page_that_went_away():
    """用户在轮询期间关掉标签页 / 跳走了——单轮失败不该让会话整个垮掉。"""

    class Exploding(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            self.expressions.append(expression)
            if "rf:live-state" in expression:
                raise RuntimeError("target closed")
            return super().evaluate(expression, timeout=timeout)

    client = Exploding()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        # 异常在**主循环**里被接住：单轮失败只会记一条日志，会话继续活着
        # （用户在轮询期间关掉标签页或跳走是常事）。
        with pytest.raises(RuntimeError):
            session._tick()
        assert session.is_running is True
        assert live_module.POLL_INTERVAL_SECONDS > 0
    finally:
        session.stop()


def test_a_reloaded_page_gets_the_listener_reinstalled():
    """页面跳转/刷新会把注入的监听带走，会话要**自己发现并装回去**。

    真实故障：用户在 Edge 里开着「点哪个填哪个」，页面一跳转（SPA 整页跳转、登录回跳、
    或自己点了个链接），页面上的监听与面板就全没了——而会话仍然报告「运行中」，
    ResumeForge 那边也显示着"已开启"。用户点到哪个框都毫无反应，且**没有任何提示**
    能解释为什么。这条钉住自愈。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        assert client.installed is True

        # 模拟一次整页跳转：文档换了，注入的东西随之消失。
        client.installed = False
        client.focus = None
        session._seq = 7  # 旧文档留下的序号，新文档不会从 7 开始

        session._tick()

        assert client.installed is True, "页面跳转后应该重新装上监听"
        # 序号要归零：新文档的 __rfFocusSeq 从 0 开始，留着旧值可能正好撞上而漏掉第一次聚焦。
        assert session._seq == 0
    finally:
        session.stop()


def test_the_reinstall_also_pushes_the_catalog_again():
    """重装时要连「换个资料…」的清单一起送——新文档里那份也随旧文档没了。

    只装监听不送清单的话，用户跳转后第一次点「换个资料…」会看到**空列表**，
    而那看起来像"你的资料不见了"。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"}, [{"label": "姓名", "value": "张三"}])
    session.start()
    try:
        client.installed = False
        client.expressions.clear()

        session._tick()

        pushed = [e for e in client.expressions if "rf:live-catalog" in e]
        assert pushed, "重装时没有重新推送清单"
        assert "张三" in pushed[0]
    finally:
        session.stop()


def test_disabled_live_session_reinstalls_the_control_ball_after_page_reload():
    """关闭填表响应后，页面跳转仍要保留可重新开启的悬浮球。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        session.set_enabled(False)
        client.installed = False
        client.expressions.clear()

        session._tick()

        assert client.installed is True
        assert any("rf:live-control" in expression for expression in client.expressions)
    finally:
        session.stop()


def test_disabled_live_session_does_not_show_focus_panel():
    """关闭智能逐项填表后，输入框聚焦不应再出现"正在看这个框"卡片。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        session.set_enabled(False)
        client.focus_on(raw_control(label="姓名"))
        session._tick()

        assert session.state["enabled"] is False
        assert not [expression for expression in client.expressions if "rf:live-panel" in expression]
    finally:
        session.stop()


def test_a_page_that_never_reports_installed_is_not_reinstalled_every_tick():
    """探测里**没有** ``installed`` 字段时不该每轮重装。

    （旧版注入脚本、或测试里的假客户端可能不返回这个字段。判据必须是 ``is False``
    而不是"假值"，否则每一轮都会白发一次注入。）
    """

    class NoFlag(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            if "rf:live-state" in expression:
                # 老形状：没有 installed 字段。
                return json.dumps({"seq": self.seq, "control": self.focus, "accept": self.accept})
            return super().evaluate(expression, timeout=timeout)

    client = NoFlag()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.expressions.clear()
        session._tick()
        session._tick()

        assert not [e for e in client.expressions if "rf:live-listener" in e], (
            "探测没报 installed 时不该反复重装"
        )
    finally:
        session.stop()
