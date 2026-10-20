# SPDX-License-Identifier: Apache-2.0
"""站点适配器契约测试的共享替身（RF-19）。

把 test_boss_apply.py 的 ``MarkerClient`` 泛化为 ``ScriptedSiteClient``：按 JS 注释
marker（``/* rf:xxx */``）应答一段**有序**状态序列，并记录全部 CDP 调用。契约测试
（test_site_adapter_contract.py）用它把"适配器在给定页面状态下怎么走"固化成
fixtures/sites/<site>/*.json 里的场景，站点改版时先红在这里。

语义（与原 MarkerClient 逐点一致，既有用例行为零变化）：

- 每个 marker 的 ``states`` 按 evaluate 次序逐个返回；序列给完后再次轮询重复返回**末态**
  （等待循环就绪即停，多出来的轮询不改写契约——与"pop 到只剩最后一个就一直返回它"等价）；
- ``send()`` 只记录不解释；``mouse_events()`` / ``pressed_points()`` 提取
  ``Input.dispatchMouseEvent``（BOSS 的入口/发送按钮只认可信鼠标事件，这是契约的一部分）；
- 可选 ``targets_before_click`` / ``targets_after_click``：``list_targets`` 在第一次
  ``mousePressed`` 前后返回不同标签页集合，用于"聊天页开在新标签页"的收养场景；
- ``switch_to_target`` 记录调用并返回 True（收养路径的替身，真实切换由 CDP 层负责）。

``assert_all_consumed()`` 是"跑完一条不剩"的调用断言：每个 marker 的序列都被**完整服务
过**。脚本多写了状态（适配器根本没轮询那么多次）或适配器少轮询一次，都会红。
"""
from __future__ import annotations

from typing import Any

from app.services.browser.cdp_client import CdpClient


class ScriptedSiteClient(CdpClient):
    """按 marker 应答有序状态序列的假客户端（原 MarkerClient 的泛化）。"""

    def __init__(
        self,
        responses: dict[str, Any],
        *,
        targets_before_click: list[dict[str, Any]] | None = None,
        targets_after_click: list[dict[str, Any]] | None = None,
    ) -> None:
        self.responses = {
            marker: list(value) if isinstance(value, list) else [value]
            for marker, value in responses.items()
        }
        self.cursors: dict[str, int] = {}
        self.expressions: list[str] = []
        self.sends: list[tuple[str, dict]] = []
        self.switch_calls: list[str] = []
        self._targets_before_click = list(targets_before_click or [])
        self._targets_after_click = (
            list(targets_after_click) if targets_after_click is not None else None
        )
        self._mouse_pressed = False

    # --- CdpClient 接口 ---

    def list_targets(self) -> list[dict[str, Any]]:
        if self._targets_after_click is not None and self._mouse_pressed:
            return list(self._targets_after_click)
        return list(self._targets_before_click)

    def new_tab(self, url: str = "about:blank") -> str:
        return "tab"

    def navigate(self, url: str, *, timeout=None):  # noqa: ANN201
        return {}

    def send(self, method: str, params: dict | None = None, *, timeout=None) -> dict:  # noqa: ANN201
        params = params or {}
        self.sends.append((method, dict(params)))
        if method == "Input.dispatchMouseEvent" and params.get("type") == "mousePressed":
            self._mouse_pressed = True
        return {}

    def evaluate(self, expression: str, *, timeout=None) -> Any:
        self.expressions.append(expression)
        for marker, states in self.responses.items():
            if marker in expression:
                cursor = self.cursors.get(marker, 0)
                if cursor < len(states):
                    self.cursors[marker] = cursor + 1
                    return states[cursor]
                return states[-1] if states else None
        return None

    def switch_to_target(self, target_id: str) -> bool:
        self.switch_calls.append(target_id)
        return True

    def close(self) -> None:
        return None

    # --- 契约断言辅助 ---

    def mouse_events(self) -> list[tuple[str, float, float]]:
        return [
            (params["type"], float(params["x"]), float(params["y"]))
            for method, params in self.sends
            if method == "Input.dispatchMouseEvent"
        ]

    def pressed_points(self) -> list[tuple[float, float]]:
        return [(x, y) for (kind, x, y) in self.mouse_events() if kind == "mousePressed"]

    def assert_all_consumed(self) -> None:
        """每个 marker 的状态序列都被完整服务过——脚本与调用序列必须互相咬合。"""
        remaining = {
            marker: len(states) - self.cursors.get(marker, 0)
            for marker, states in self.responses.items()
            if self.cursors.get(marker, 0) < len(states)
        }
        assert not remaining, f"脚本里还有没被服务到的状态（适配器少轮询或脚本多写）：{remaining}"

    def assert_no_unexpected_clicks(self, expected_points: list[list[float]]) -> None:
        """可信点击只发生在预期坐标上：多一次、少一次、坐标漂移都红。"""
        assert self.pressed_points() == [tuple(point) for point in expected_points], (
            f"可信点击序列不符：实际 {self.pressed_points()}，预期 {expected_points}"
        )


__all__ = ["ScriptedSiteClient"]
