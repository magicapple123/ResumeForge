"""BOSS 沟通入口、跨页导航、招呼语填写、可信点击与发送结果判定。

现版（2026 年实测）交互形态，与旧实现的两点根本差异：

1. **入口按钮只响应可信用户事件**。岗位详情页的「立即沟通 / 继续沟通」对
   ``element.click()`` 这类 ``isTrusted=false`` 的合成事件没有反应（页面纹丝不动），
   必须用 CDP ``Input.dispatchMouseEvent`` 在按钮真实坐标上发起鼠标按下/抬起。
2. **点击后是整页跳转到 ``/web/geek/chat`` 聊天页**，不是在岗位详情页里弹出聊天层。
   聊天输入框是 ``#chat-input``（``div.chat-input[contenteditable=true]``），发送按钮是
   ``button.btn-send``（空内容时带 ``disabled`` class）。因此流程必须能跨导航等待，
   不能再用"仍停留在岗位页"作为成功前提。

两条 2026-09-20 真实投递失败换来的加固（都用真实浏览器复现验证过）：

3. **点击前必须确保窗口可见**。浏览器窗口最小化 / 被完全遮挡 / 位于未激活的虚拟桌面时，
   页面 ``document.visibilityState`` 为 ``"hidden"``，BOSS 对这种页面上的点击**静默忽略**
   （真实用户不可能点击看不见的页面）——事件以 ``isTrusted=true`` 正常到达按钮，但页面
   毫无反应，投递最终在"等聊天输入框"上超时。``Page.bringToFront`` 救不了最小化的窗口，
   必须走 ``Browser.setWindowBounds``（见 ``cdp_client.WindowAwareMixin``）。
4. **点击后兼容"聊天页开在新标签页"**。真实环境里见过聊天页以新标签页打开、原标签页
   停在岗位详情的情况；等待循环会比对点击前后的标签页快照，把**新出现**的聊天标签页
   收养为后续填写/发送的目标。只收养新标签页：点击前就已存在的聊天标签页（可能是用户
   自己开着的旧会话）绝不能碰，否则招呼语会发进错误的会话。
5. **兼容"新会话不跳聊天页"的对话框形态**（2026-09-20 真实发现）：对从未沟通过的岗位，
   点击「立即沟通」后 BOSS 在**详情页内弹出打招呼对话框**（``.startchat-dialog``，输入框是
   ``.dialog-container textarea``，发送按钮是 ``div.send-message``——不是 button、类名不含
   btn）。BOSS 打开对话框时会**自动发出**用户在站点里配置的默认招呼语（对话框显示
   「已发送 …」），我们的招呼语作为追加消息填写发送。成功判定必须排除"对话框开着、
   草稿没发出去"的反例（见 ``_submit_state_script``）。

发送按钮同样用可信点击；发送成功以聊天页出现包含招呼语的**本人消息气泡**（或对话框
「已发送」态）为准。
"""
from __future__ import annotations

import logging
from typing import Any

from ...models.apply import FAILURE_GREETING_MISSING, FAILURE_SELECTOR_INVALID
from ..browser.cdp_client import CdpClient, CdpError
from ..browser.interaction import trusted_click
from ..browser.page_ready import wait_for_page_state
from .base import ApplyOutcome, SiteFailure
from .boss_apply_scripts import (
    _apply_entry_script as _apply_entry_script,
)
from .boss_apply_scripts import (
    _chat_state_script as _chat_state_script,
)
from .boss_apply_scripts import (
    _click_apply_script as _click_apply_script,
)
from .boss_apply_scripts import (
    _click_script as _click_script,
)
from .boss_apply_scripts import (
    _click_send_script as _click_send_script,
)
from .boss_apply_scripts import (
    _entry_rect_script as _entry_rect_script,
)
from .boss_apply_scripts import (
    _entry_script as _entry_script,
)
from .boss_apply_scripts import (
    _fill_greeting_script as _fill_greeting_script,
)
from .boss_apply_scripts import (
    _greeting_state_script as _greeting_state_script,
)
from .boss_apply_scripts import (
    _send_rect_script as _send_rect_script,
)
from .boss_apply_scripts import (
    _submit_state_script as _submit_state_script,
)
from .boss_page import (
    CHAT_PAGE_PATH,
    _as_payload,
    _current_url,
    blocker_failure,
    detect_blocker,
    same_target_page,
    selector_diagnostic,
)

logger = logging.getLogger(__name__)


def classify_submit_state(state: dict[str, Any], greeting: str = "") -> ApplyOutcome:
    """把发送后的页面状态判成成功/失败：登录失效或验证码立刻失败，成功标记才返回 success。"""
    blocker = detect_blocker(state)
    if blocker is not None:
        raise blocker_failure(blocker, state)
    if state.get("success"):
        return ApplyOutcome(success=True, greeting_sent=greeting)
    raise SiteFailure(
        FAILURE_SELECTOR_INVALID,
        selector_diagnostic(state, "发送结果确认（已出现本人消息或“发送成功”提示）"),
        url=state.get("url") or "",
        title=state.get("title") or "",
    )


class BossApplyMixin:
    """BOSS 自动沟通流程：可信点击沟通入口 → 跨页进入聊天页 → 填招呼语 → 可信点击发送。"""

    def _wait_state(
        self,
        client: CdpClient,
        initial: dict[str, Any],
        script: str,
        *,
        ready,
        expected: str,
        probe_override=None,
    ) -> dict[str, Any]:
        first = True

        def _probe() -> Any:
            nonlocal first
            if first:
                first = False
                return initial
            if probe_override is not None:
                try:
                    return probe_override()
                except CdpError:
                    return {}
            try:
                value = _as_payload(client.evaluate(script))
            except CdpError:
                # 点击入口会触发整页导航，导航瞬间的 evaluate 可能短暂失败——
                # 这属于"新文档还没就绪"，按未就绪继续轮询，而不是直接打死整个投递。
                return {}
            return value if isinstance(value, dict) else {}

        def _blocker(state: dict[str, Any]) -> SiteFailure | None:
            kind = detect_blocker(state)
            return blocker_failure(kind, state) if kind is not None else None

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(
                FAILURE_SELECTOR_INVALID,
                selector_diagnostic(state, expected),
                url=state.get("url") or "",
                title=state.get("title") or "",
            )

        return wait_for_page_state(
            _probe,
            is_ready=ready,
            blocker=_blocker,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    def _ensure_apply_entry(self, state: dict[str, Any]) -> None:
        blocker = detect_blocker(state)
        if blocker is not None:
            raise blocker_failure(blocker, state)
        present = state.get("found")
        if present is None:
            present = int(state.get("matched", 0) or 0) > 0
        if not present:
            raise SiteFailure(
                FAILURE_SELECTOR_INVALID,
                selector_diagnostic(state, "“立即沟通 / 继续沟通”入口"),
                url=state.get("url") or "",
                title=state.get("title") or "",
            )

    def _trusted_click(self, client: CdpClient, x: float, y: float) -> None:
        """在视口坐标上发起可信鼠标点击。

        实现已提到 ``services/browser/interaction.py``（网申填表要用同一套），这里保留
        方法只是为了让子类与既有测试仍能按原样调用/patch 它。
        """
        trusted_click(client, x, y)

    def _page_snapshot(self, client: CdpClient) -> set[str]:
        """当前全部 page 目标的 id 快照（供"点击后新开标签页"比对）。"""
        try:
            return {
                str(item.get("id", ""))
                for item in client.list_targets()
                if item.get("type") == "page"
            }
        except CdpError:
            return set()

    def open_apply(self, client: CdpClient, job: Any) -> None:
        """打开岗位页并等待「立即沟通 / 继续沟通」入口就绪。"""
        url = getattr(job, "source_url", "") or ""
        if not url:
            raise SiteFailure(FAILURE_SELECTOR_INVALID, "该岗位没有投递链接，无法自动投递")
        _current_url(client)
        client.navigate(url)
        initial = _as_payload(client.evaluate(_apply_entry_script()))
        state = initial if isinstance(initial, dict) else {}
        state = self._wait_state(
            client,
            state,
            _apply_entry_script(),
            ready=lambda item: bool(item.get("found"))
            and same_target_page(str(item.get("url") or ""), url),
            expected="“立即沟通 / 继续沟通”入口",
        )
        self._ensure_apply_entry(state)

    def _wait_entry_rect(self, client: CdpClient) -> dict[str, Any]:
        """在岗位详情页拿到沟通入口的真实坐标。"""
        try:
            initial = _as_payload(client.evaluate(_entry_rect_script()))
        except CdpError:
            initial = {}
        state = initial if isinstance(initial, dict) else {}
        state = self._wait_state(
            client,
            state,
            _entry_rect_script(),
            ready=lambda item: bool(item.get("found"))
            and float(item.get("width", 0) or 0) > 0,
            expected="可点击的“立即沟通 / 继续沟通”入口",
        )
        self._ensure_apply_entry(state)
        return state

    def _wait_chat_ready(
        self, client: CdpClient, *, known_page_ids: set[str] | None = None
    ) -> dict[str, Any]:
        """点击入口后等待聊天页（或页内聊天层）的输入框可用。

        ``known_page_ids`` 是点击**前**的 page 目标 id 快照。等待期间若当前页迟迟没有
        聊天输入框、而浏览器里**新出现**了一个聊天页标签页（id 不在快照里），就切换过去
        继续等待——聊天页开在新标签页是真实环境里出现过的形态。只收养新标签页：点击前
        就存在的聊天标签页可能是用户自己开着的旧会话，绝不能碰，否则招呼语会发错会话。
        """
        try:
            initial = _as_payload(client.evaluate(_chat_state_script()))
        except CdpError:
            # 点击入口触发整页导航，第一次探测就可能撞上"执行上下文已销毁"。
            initial = {}
        state = initial if isinstance(initial, dict) else {}

        adopted: dict[str, bool] = {"done": False}

        def _probe() -> dict[str, Any]:
            value = _as_payload(client.evaluate(_chat_state_script()))
            if isinstance(value, dict) and value.get("input_found"):
                return value
            # 当前页还没就绪：若允许，把"点击后新出现的聊天标签页"收养过来再探一次。
            if known_page_ids is not None and not adopted["done"]:
                adopted["done"] = True  # 无论结果如何只尝试一次，避免反复跳标签页
                candidate = self._new_chat_tab_id(client, known_page_ids)
                if candidate:
                    switch = getattr(client, "switch_to_target", None)
                    if switch is not None and switch(candidate):
                        logger.info("聊天页在新标签页打开，已切换过去继续投递")
                        try:
                            value = _as_payload(client.evaluate(_chat_state_script()))
                        except CdpError:
                            value = {}
            return value if isinstance(value, dict) else {}

        state = self._wait_state(
            client,
            state,
            _chat_state_script(),
            probe_override=_probe,
            ready=lambda item: bool(item.get("input_found")),
            expected="聊天页输入框（点击沟通后进入 /web/geek/chat）",
        )
        return state

    def _new_chat_tab_id(self, client: CdpClient, known_page_ids: set[str]) -> str:
        """在标签页列表里找出点击后新出现的聊天页目标 id；没有返回空串。"""
        try:
            targets = client.list_targets()
        except CdpError:
            return ""
        for item in targets:
            if item.get("type") != "page":
                continue
            target_id = str(item.get("id", ""))
            url = str(item.get("url") or "")
            if not target_id or target_id in known_page_ids:
                continue
            if CHAT_PAGE_PATH in url:
                return target_id
        return ""

    def _wait_send_ready(self, client: CdpClient) -> dict[str, Any]:
        """填入招呼语后等待发送按钮变为可用（disabled class 移除），返回其坐标。"""
        try:
            initial = _as_payload(client.evaluate(_send_rect_script()))
        except CdpError:
            initial = {}
        state = initial if isinstance(initial, dict) else {}
        state = self._wait_state(
            client,
            state,
            _send_rect_script(),
            ready=lambda item: bool(item.get("found"))
            and not item.get("disabled")
            and float(item.get("width", 0) or 0) > 0,
            expected="可点击的“发送”按钮（填入招呼语后启用）",
        )
        return state

    def fill_and_submit(
        self, client: CdpClient, data: dict[str, Any], greeting: str
    ) -> ApplyOutcome:
        """执行一次投递：可信点击沟通入口 → 进聊天页 → 填招呼语 → 可信点击发送，再确认结果。"""
        greeting = (greeting or "").strip()

        # 1) 岗位详情页：定位沟通入口坐标（open_apply 已确认过入口，这里取坐标并再验一次）。
        entry = self._wait_entry_rect(client)

        # 2) 招呼语是 BOSS 沟通链路的必填内容；在点击入口之前就拦下，避免无谓建立会话。
        if not greeting:
            raise SiteFailure(
                FAILURE_GREETING_MISSING,
                "该岗位投递必须填写招呼语：请在投递队列里为它填写，或设置默认招呼语",
                url=entry.get("url") or "",
                title=entry.get("title") or "",
            )

        # 3) 可信点击沟通入口（合成 click 对现版按钮无效），随后整页跳转到聊天页。
        #    快照点击前的标签页集合：聊天页若开在**新**标签页里，等待循环要靠它收养；
        #    点击前就存在的聊天标签页不属于这次投递，绝不能碰。
        page_ids_before_click = self._page_snapshot(client)
        self._trusted_click(client, float(entry["x"]), float(entry["y"]))
        self._wait_chat_ready(client, known_page_ids=page_ids_before_click)

        # 4) 在聊天页写入招呼语。
        filled = _as_payload(client.evaluate(_fill_greeting_script(greeting)))
        fill_state = filled if isinstance(filled, dict) else {}
        if fill_state.get("ok") is not True:
            raise SiteFailure(
                FAILURE_SELECTOR_INVALID,
                selector_diagnostic(fill_state, "可写入的聊天输入框"),
                url=fill_state.get("url") or "",
                title=fill_state.get("title") or "",
            )

        # 5) 等发送按钮启用后可信点击。
        send = self._wait_send_ready(client)
        self._trusted_click(client, float(send["x"]), float(send["y"]))

        # 6) 等待本人消息气泡出现作为发送成功凭据。
        initial_result = _as_payload(client.evaluate(_submit_state_script(greeting)))
        result = initial_result if isinstance(initial_result, dict) else {}
        result = self._wait_state(
            client,
            result,
            _submit_state_script(greeting),
            ready=lambda item: bool(item.get("success")),
            expected="发送结果确认（已出现本人消息或“发送成功”提示）",
        )
        return classify_submit_state(result, greeting=greeting)


__all__ = [
    "BossApplyMixin",
    "_apply_entry_script",
    "_chat_state_script",
    "_click_apply_script",
    "_click_script",
    "_click_send_script",
    "_entry_rect_script",
    "_fill_greeting_script",
    "_greeting_state_script",
    "_send_rect_script",
    "_submit_state_script",
    "classify_submit_state",
]
