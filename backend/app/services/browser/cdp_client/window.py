"""``WindowAwareMixin``：窗口可见性保障与标签页切换。

私有属性契约：本 mixin 通过 ``self._target`` / ``self._connection`` /
``self._target_id`` / ``self._reset_connection`` / ``self._connection_handle``
读写宿主 ``WebsocketCdpClient``（websocket_client.py）——整类搬运、成员名不得改动。
"""
from __future__ import annotations

import logging
import time

from .base import CdpError

logger = logging.getLogger(__name__)


class WindowAwareMixin:
    """窗口可见性保障与标签页切换：只在 ``WebsocketCdpClient`` 上实现。

    **为什么需要**（2026-09-20 真实投递失败的根因）：浏览器窗口被最小化 / 遮挡 /
    放在未激活的虚拟桌面上时，页面的 ``document.visibilityState`` 是 ``"hidden"``；
    BOSS 直聘对隐藏页面上的点击**静默忽略**（真实用户不可能点击看不见的页面——这是
    它的反自动化启发式之一）。而 ``Page.bringToFront`` 只能在窗口内部切标签页，
    **不能还原最小化的窗口**，所以点击前必须走 ``Browser.setWindowBounds``。

    实测有效的还原顺序：先按窗口当前状态处理（最小化 → 还原成 normal），再
    ``Page.bringToFront``；若仍不可见，用「最小化 → 还原」切换强制 Windows 重新
    激活窗口（对被完全遮挡、位于其他虚拟桌面的窗口同样有效）。
    """

    _VISIBILITY_PROBE = 'document.visibilityState || "unknown"'

    def ensure_page_visible(self, *, timeout_seconds: float = 8.0) -> bool:
        """确保当前标签页所在窗口可见，返回最终是否 ``visible``。

        失败**不抛异常**、只返回 False：个别环境（无头、远程会话）确实无法还原窗口，
        此时上层流程按原样继续——等待与超时诊断仍然有效，只是把"为什么点不动"这句
        话提前写进日志，而不是让用户面对一条莫名的选择器超时。

        还原手段按强度递增（2026-09-20 实测排序）：
        1. ``Target.activateTarget``——**一步就能把最小化/被遮挡窗口还原并前置**（实测
           ``windowState=minimized`` 下也生效），首选；
        2. 最小化 → ``setWindowBounds(normal)`` 还原；
        3. 「最小化 → 还原」切换强制 Windows 重新激活（对位于其他虚拟桌面的窗口有效）；
        4. ``Page.bringToFront`` 收尾。
        """
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        last_state = ""
        target_id = str((self._target or {}).get("id", "") or "")
        try:
            self.send("Page.enable")
        except CdpError:
            return False

        def _activate() -> None:
            if target_id:
                try:
                    self.send("Target.activateTarget", {"targetId": target_id})
                except CdpError:
                    pass

        while True:
            try:
                last_state = str(self.evaluate(self._VISIBILITY_PROBE) or "")
                if last_state == "visible":
                    return True
                _activate()
                if str(self.evaluate(self._VISIBILITY_PROBE) or "") == "visible":
                    return True
                window = self.send("Browser.getWindowForTarget")
                window_id = window.get("windowId")
                bounds = window.get("bounds") or {}
                if not window_id:
                    return False
                if bounds.get("windowState") == "minimized":
                    # 最小化：还原即可。
                    self.send(
                        "Browser.setWindowBounds",
                        {"windowId": window_id, "bounds": {"windowState": "normal"}},
                    )
                else:
                    # 被遮挡 / 在未激活的虚拟桌面：最小化→还原切换一次，
                    # 强制窗口管理器重新激活（activateTarget 对这种情况可能无效）。
                    self.send(
                        "Browser.setWindowBounds",
                        {"windowId": window_id, "bounds": {"windowState": "minimized"}},
                    )
                    time.sleep(0.3)
                    self.send(
                        "Browser.setWindowBounds",
                        {"windowId": window_id, "bounds": {"windowState": "normal"}},
                    )
                _activate()
                try:
                    self.send("Page.bringToFront")
                except CdpError:
                    pass
            except CdpError as exc:
                logger.debug("窗口可见性保障失败：%s", exc)
                return False
            if time.monotonic() >= deadline:
                return last_state == "visible"
            time.sleep(0.5)

    def switch_to_target(self, target_id: str) -> bool:
        """把后续命令切换到另一个标签页；切换失败返回 False（调用方自行决定回退）。

        用途：点击岗位页的「立即沟通」后，聊天页**可能开在新标签页**而不是整页跳转。
        调用方先比对 ``list_targets()`` 的前后快照找出新出现的聊天标签页，再切换过去，
        后续填写 / 发送就落在正确的页面上。
        """
        wanted = str(target_id or "").strip()
        if not wanted:
            return False
        try:
            targets = self.list_targets()
        except CdpError:
            return False
        target = next(
            (
                item
                for item in targets
                if item.get("type") == "page" and str(item.get("id", "")) == wanted
            ),
            None,
        )
        if target is None or not target.get("webSocketDebuggerUrl"):
            return False
        current_id = str((self._target or {}).get("id", ""))
        if current_id == wanted and self._connection is not None:
            return True
        self._target = target
        self._target_id = wanted
        # 目标变了，旧 WebSocket 必须重连（与 new_tab 同一套纪律）。
        self._reset_connection()
        try:
            self._connection_handle()
        except CdpError:
            return False
        return True

