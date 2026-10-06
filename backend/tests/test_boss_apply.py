"""BOSS 沟通流程：语义入口、可信点击、跨页进入聊天页、contenteditable、发送与确认。

现版 BOSS 的两个硬约束（2026 年真机实测）：
1. 「立即沟通/继续沟通」与「发送」按钮忽略合成 ``element.click()``（isTrusted=false），
   只响应 CDP ``Input.dispatchMouseEvent`` 的可信鼠标事件；
2. 点入口后是**整页跳转到 /web/geek/chat**，流程必须能跨导航等待聊天输入框。

（拆分说明：startchat 对话框形态与聊天输入框容器内兜底在 test_boss_apply_dialog.py。
``MarkerClient`` 与常量/helper 留在本文件供其复用。）
"""
from __future__ import annotations

import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_GREETING_MISSING,
    FAILURE_SELECTOR_INVALID,
)
from app.services.browser.cdp_client import CdpClient, CdpError
from app.services.browser.page_ready import ReadyWait
from app.services.sites.base import SiteFailure
from app.services.sites.boss import BossAdapter
from app.services.sites.boss_apply import (
    _apply_entry_script,
    _chat_state_script,
    _entry_rect_script,
    _fill_greeting_script,
    _send_rect_script,
)

# **两档预算，别混用**：
#
# - ``FAST_WAIT``：给**期望超时**的用例。它们必须让预算真的到期才能产生失败，所以越小越快。
# - ``READY_WAIT``：给**期望成功**的用例。就绪即刻返回，预算大小不影响耗时，它只是安全网——
#   而 20ms 的安全网在并行负载下靠不住：本文件曾因 ``test_navigation_evaluate_errors_...``
#   单独跑必过、``-n auto`` 下偶发失败，根因就是**用例成败取决于真实墙钟**（一次调度抖动
#   就超过 20ms）。放宽到 2s 等于把"抛硬币"换成"不会误伤"，而不多用一毫秒。
FAST_WAIT = ReadyWait(timeout=0.02, poll_interval=0.001)
READY_WAIT = ReadyWait(timeout=2.0, poll_interval=0.001)

JOB_URL = "https://www.zhipin.com/job_detail/new.html"
CHAT_URL = "https://www.zhipin.com/web/geek/chat"
GREETING = "您好，我对这个岗位很感兴趣"


class MarkerClient(CdpClient):
    """按 JS 注释 marker 返回脚本结果；send() 记录可信输入事件。"""

    def __init__(self, responses):
        self.responses = {
            marker: list(value) if isinstance(value, list) else [value]
            for marker, value in responses.items()
        }
        self.expressions: list[str] = []
        self.sends: list[tuple[str, dict]] = []

    def list_targets(self):
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "tab"

    def navigate(self, url: str, *, timeout=None):
        return {}

    def send(self, method, params=None, *, timeout=None):
        self.sends.append((method, params or {}))
        return {}

    def evaluate(self, expression, *, timeout=None):
        self.expressions.append(expression)
        for marker, values in self.responses.items():
            if marker in expression:
                if len(values) > 1:
                    return values.pop(0)
                return values[0]
        return None

    def close(self):
        return None

    def mouse_events(self) -> list[tuple[str, float, float]]:
        return [
            (params["type"], float(params["x"]), float(params["y"]))
            for method, params in self.sends
            if method == "Input.dispatchMouseEvent"
        ]

    def pressed_points(self) -> list[tuple[float, float]]:
        return [(x, y) for (kind, x, y) in self.mouse_events() if kind == "mousePressed"]


def _entry_rect(**overrides):
    state = {
        "found": True,
        "matched": 1,
        "label": "继续沟通",
        "x": 500.0,
        "y": 200.0,
        "width": 120.0,
        "height": 40.0,
        "url": JOB_URL,
        "title": "岗位详情",
    }
    state.update(overrides)
    return state


def _chat_state(**overrides):
    state = {
        "on_chat": True,
        "input_found": True,
        "found": True,
        "kind": "contenteditable",
        "position": "后端开发",
        "name": "成女士",
        "url": CHAT_URL,
        "title": "聊天",
    }
    state.update(overrides)
    return state


def _send_rect(**overrides):
    state = {
        "found": True,
        "disabled": False,
        "matched": 1,
        "label": "发送",
        "x": 900.0,
        "y": 700.0,
        "width": 60.0,
        "height": 36.0,
        "url": CHAT_URL,
        "title": "聊天",
    }
    state.update(overrides)
    return state


def _responses(greeting=GREETING):
    return {
        "rf:entry-rect": _entry_rect(),
        # 第一次探测仍在岗位页（导航未完成），第二次才进入聊天页。
        "rf:chat-state": [
            _chat_state(on_chat=False, input_found=False, found=False, kind="", url=JOB_URL),
            _chat_state(),
        ],
        "rf:fill-greeting": {"ok": True, "value": greeting},
        "rf:send-rect": _send_rect(),
        "rf:submit-state": [
            {"success": False, "matched": 0, "url": CHAT_URL, "title": "聊天"},
            {"success": True, "sent_message": True, "matched": 1,
             "url": CHAT_URL, "title": "聊天"},
        ],
    }


# ===== 生成的脚本本身的契约（改版回归） =====


def test_entry_discovery_is_semantic_for_start_and_continue_chat():
    script = _apply_entry_script()
    assert "立即沟通" in script
    assert "继续沟通" in script
    assert "role=\"button\"" in script or "[role='button']" in script


def test_entry_rect_returns_a_viewport_center_point():
    script = _entry_rect_script()
    assert "rf:entry-rect" in script
    assert "scrollIntoView" in script
    assert "rect.x + rect.width / 2" in script
    assert "rect.y + rect.height / 2" in script


def test_chat_state_detects_the_standalone_chat_page_and_composer():
    script = _chat_state_script()
    assert r"\/web\/geek\/chat" in script
    assert "input_found" in script
    assert "#chat-input" in script


def test_send_rect_treats_disabled_class_as_not_clickable():
    script = _send_rect_script()
    assert "classList.contains('disabled')" in script
    assert "btn-send" in script


def test_greeting_writer_supports_contenteditable_and_dispatches_input():
    script = _fill_greeting_script("您好")
    assert "isContentEditable" in script
    assert "textContent" in script
    assert "input" in script


# ===== open_apply（岗位页入口确认，保持原行为） =====


def test_open_apply_ignores_a_stale_previous_job_until_the_target_page_appears():
    target = JOB_URL
    client = MarkerClient(
        {
            "rf:url": {"url": "https://www.zhipin.com/job_detail/old.html"},
            "rf:apply-entry": [
                {"found": True, "matched": 1,
                 "url": "https://www.zhipin.com/job_detail/old.html"},
                {"found": True, "matched": 1, "url": target},
            ],
        }
    )
    job = type("Job", (), {"source_url": target})()

    BossAdapter(ready_wait=READY_WAIT).open_apply(client, job)

    assert sum("rf:apply-entry" in item for item in client.expressions) >= 2


# ===== fill_and_submit 主链路 =====


def test_fill_and_submit_trusted_clicks_navigates_fills_sends_and_confirms():
    client = MarkerClient(_responses())

    outcome = BossAdapter(ready_wait=READY_WAIT).fill_and_submit(client, {}, GREETING)

    assert outcome.success is True
    assert outcome.greeting_sent == GREETING
    # 跨导航等待：聊天页状态至少探测两次（岗位页 → 聊天页）。
    assert sum("rf:chat-state" in item for item in client.expressions) >= 2
    # 招呼语确实写入。
    assert any("rf:fill-greeting" in item for item in client.expressions)
    # 发送结果确认至少两次（首次未确认 → 出现本人消息）。
    assert sum("rf:submit-state" in item for item in client.expressions) >= 2
    # 两个可信点击：沟通入口 (500,200) 与发送按钮 (900,700)，坐标来自探针 rect。
    assert client.pressed_points() == [(500.0, 200.0), (900.0, 700.0)]
    # 整条链路不再使用合成 node.click() 探针。
    assert not any("rf:click-apply" in item or "rf:click-send" in item
                   for item in client.expressions)


def test_trusted_click_dispatches_a_full_mouse_press_release_sequence():
    client = MarkerClient(_responses())
    BossAdapter(ready_wait=READY_WAIT).fill_and_submit(client, {}, GREETING)

    entry_events = [
        (method, params) for method, params in client.sends
        if method == "Input.dispatchMouseEvent" and params.get("x") == 500.0
    ]
    kinds = [params["type"] for _, params in entry_events]
    assert kinds == ["mouseMoved", "mousePressed", "mouseReleased"]
    pressed = next(params for _, params in entry_events if params["type"] == "mousePressed")
    assert pressed["button"] == "left" and pressed["buttons"] == 1
    assert any(method == "Page.bringToFront" for method, _ in client.sends)


def test_empty_greeting_is_blocked_before_any_click():
    """空招呼语必须在点击沟通入口之前拦下，避免无谓建立会话/产生 HR 端通知。"""
    client = MarkerClient({"rf:entry-rect": _entry_rect()})

    with pytest.raises(SiteFailure) as excinfo:
        BossAdapter(ready_wait=FAST_WAIT).fill_and_submit(client, {}, "")

    assert excinfo.value.category == FAILURE_GREETING_MISSING
    assert client.pressed_points() == []


def test_missing_entry_is_an_explicit_selector_failure():
    client = MarkerClient(
        {"rf:entry-rect": _entry_rect(found=False, matched=0, label="",
                                      x=0, y=0, width=0, height=0)}
    )

    with pytest.raises(SiteFailure) as excinfo:
        BossAdapter(ready_wait=FAST_WAIT).fill_and_submit(client, {}, GREETING)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert "沟通" in excinfo.value.detail
    assert client.pressed_points() == []


def test_chat_page_never_appearing_times_out_with_diagnostics():
    """点击后始终停在岗位页、聊天输入框不出现 → selector_invalid，而不是误报成功。"""
    responses = _responses()
    responses["rf:chat-state"] = _chat_state(
        on_chat=False, input_found=False, found=False, kind="",
        position="", name="", url=JOB_URL, title="岗位详情",
    )
    client = MarkerClient(responses)

    with pytest.raises(SiteFailure) as excinfo:
        BossAdapter(ready_wait=FAST_WAIT).fill_and_submit(client, {}, GREETING)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert "聊天页输入框" in excinfo.value.detail
    # 入口点击已发生，但绝不能点到发送。
    assert client.pressed_points() == [(500.0, 200.0)]


def test_send_button_that_stays_disabled_is_an_explicit_failure():
    responses = _responses()
    responses["rf:send-rect"] = _send_rect(found=False, disabled=True)
    client = MarkerClient(responses)

    with pytest.raises(SiteFailure) as excinfo:
        BossAdapter(ready_wait=FAST_WAIT).fill_and_submit(client, {}, GREETING)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert "发送" in excinfo.value.detail
    # 只点了入口，没点到（一直 disabled 的）发送按钮。
    assert client.pressed_points() == [(500.0, 200.0)]


def test_clicking_send_without_confirmation_times_out_instead_of_claiming_success():
    responses = _responses()
    responses["rf:submit-state"] = {
        "success": False, "matched": 0, "url": CHAT_URL, "title": "聊天"
    }
    client = MarkerClient(responses)

    with pytest.raises(SiteFailure) as excinfo:
        BossAdapter(ready_wait=FAST_WAIT).fill_and_submit(client, {}, GREETING)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert "发送结果" in excinfo.value.detail


def test_a_captcha_after_navigation_is_propagated():
    responses = _responses()
    responses["rf:chat-state"] = _chat_state(
        on_chat=False, input_found=False, found=False, kind="",
        captcha=True, url=JOB_URL, title="岗位详情",
    )
    client = MarkerClient(responses)

    with pytest.raises(SiteFailure) as excinfo:
        BossAdapter(ready_wait=FAST_WAIT).fill_and_submit(client, {}, GREETING)

    assert excinfo.value.category == FAILURE_CAPTCHA_REQUIRED


def test_navigation_evaluate_errors_are_retried_until_chat_ready():
    """整页导航瞬间 evaluate 可能短暂报错，应当作"未就绪"继续轮询而非直接失败。"""

    class NavigatingClient(MarkerClient):
        def __init__(self, responses):
            super().__init__(responses)
            self._chat_probes = 0

        def evaluate(self, expression, *, timeout=None):
            if "rf:chat-state" in expression:
                self._chat_probes += 1
                if self._chat_probes <= 2:
                    raise CdpError("导航中，执行上下文已销毁")
            return super().evaluate(expression, timeout=timeout)

    client = NavigatingClient(_responses())
    outcome = BossAdapter(ready_wait=READY_WAIT).fill_and_submit(client, {}, GREETING)

    assert outcome.success is True
    assert client.pressed_points() == [(500.0, 200.0), (900.0, 700.0)]
