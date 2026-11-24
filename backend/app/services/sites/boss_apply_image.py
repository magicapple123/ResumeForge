# SPDX-License-Identifier: Apache-2.0
"""BOSS 聊天页补发图片：定位上传入口、把本地文件塞进去、等图片气泡出现。

**真站三项未实测（2026-11-23，务必先读）**

本机没有可用的 BOSS 登录态，而投递消息会真的发到招聘方、不可撤回，所以不允许为"验证"
去操作真站。因此下面这三件事至今仍是**推断**，代码按"两种形态都试一遍、都不成才如实失败"
写，任何一处都不假定自己是对的：

1. 「发送图片」按钮的真实 DOM（是 ``button`` 还是 ``div``、有没有稳定属性）——未实测；
2. 点击后是**页面内嵌 ``input[type=file]``**（CDP 可塞）还是**系统文件选择器**——未实测；
   两态都实现：先找现成的 input；没有就开 ``Page.setInterceptFileChooser`` 把选择器拦成
   事件、点一次按钮、再找一次 input；
3. 选完图后是否需要**预览态二次确认**——未实测；只在真的看到确认按钮时才点。

真站实测后要核对的行为与 ``progress/T8.md`` 里列的清单一一对应。**保留这份说明**：
把未实测的推断写成"已知事实"是比慢一步更贵的事故。

为什么单独成模块：``boss_apply.py`` 贴着 500 行预算，而"点哪个按钮、怎么塞文件、怎么确认
发出去了"这三件事的代码量与诊断文案都不小；本模块只做发图，由 :class:`BossApplyMixin`
继承进来（调用方仍然是 ``adapter.upload_greeting_images(...)``）。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from ...models.apply import FAILURE_FILE_UPLOAD_FAILED
from ..browser.cdp_client import CdpClient, CdpError
from ..browser.interaction import trusted_click
from ..browser.page_ready import wait_for_page_state
from .base import SiteFailure
from .boss_page import (
    SELECTOR_FILE_INPUT,
    SELECTOR_IMAGE_BUBBLE,
    SELECTOR_IMAGE_CONFIRM_BUTTON,
    SELECTOR_IMAGE_SEND_BUTTON,
    _as_payload,
    blocker_failure,
    detect_blocker,
)

logger = logging.getLogger(__name__)

# 等"input 出现"与"图片气泡出现"的两次等待共用同一份就绪参数（见 boss.py 注入）。
_STRATEGY_DOM_INPUT = "dom_input"
_STRATEGY_INTERCEPTED_CLICK = "intercepted_click"


if TYPE_CHECKING:
    from ..browser.page_ready import ReadyWait


def _js(value: str) -> str:
    return json.dumps(value)


def _image_probe_script() -> str:
    """探测图片上传的入口形态：现成的 file input、发送图片按钮坐标、确认按钮坐标。

    一次脚本拿全部三项，是为了让"看形态"与"点按钮"之间少一次往返——真站上这个工具栏
    是异步渲染的，多一次往返就多一次踩到"节点刚被重渲染"的机会。
    """
    return "".join(
        [
            "(() => { /* rf:image-probe */\n",
            f"  const SEND = {_js(SELECTOR_IMAGE_SEND_BUTTON)};\n",
            f"  const CONFIRM = {_js(SELECTOR_IMAGE_CONFIRM_BUTTON)};\n",
            f"  const INPUT = {_js(SELECTOR_FILE_INPUT)};\n",
            "  const shown = (node) => !!(node && node.getClientRects().length);\n",
            "  const rectOf = (node) => {\n",
            "    if (!shown(node)) return null;\n",
            "    const r = node.getBoundingClientRect();\n",
            "    if (!r || r.width <= 0 || r.height <= 0) return null;\n",
            "    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };\n",
            "  };\n",
            "  const inputs = [...document.querySelectorAll(INPUT)];\n",
            "  const sends = [...document.querySelectorAll(SEND)];\n",
            "  const confirms = [...document.querySelectorAll(CONFIRM)];\n",
            "  let sendRect = null;\n",
            "  for (const node of sends) { sendRect = rectOf(node); if (sendRect) break; }\n",
            "  let confirmRect = null;\n",
            "  for (const node of confirms) { confirmRect = rectOf(node); if (confirmRect) break; }\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    input_found: inputs.length > 0,\n",
            "    input_count: inputs.length,\n",
            "    send_found: sends.length > 0,\n",
            "    send_rect: sendRect,\n",
            "    confirm_rect: confirmRect,\n",
            "    image_bubbles: document.querySelectorAll("
            + _js(SELECTOR_IMAGE_BUBBLE)
            + ").length,\n",
            "    captcha: false,\n",
            "    login_required: false,\n",
            "  });\n",
            "})()",
        ]
    )


def _bubble_script() -> str:
    """只数图片气泡数量（等待循环用：短脚本、可反复调）。"""
    return "".join(
        [
            "(() => { /* rf:image-bubble */\n",
            f"  const BUBBLE = {_js(SELECTOR_IMAGE_BUBBLE)};\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    image_bubbles: document.querySelectorAll(BUBBLE).length,\n",
            "  });\n",
            "})()",
        ]
    )


class BossGreetingImageMixin:
    """聊天页补发图片的最小实现：定位 → 塞文件 → （可选）确认 → 等气泡。"""

    if TYPE_CHECKING:
        # 宿主契约：由 ``BossApplyMixin`` / ``BossAdapter`` 提供（本模块只调用，不实现）。
        _ready_wait: ReadyWait

        def _wait_state(
            self, client: CdpClient, initial: dict[str, Any], script: str, **kwargs: Any
        ) -> dict[str, Any]: ...

    # ===== 对外入口 =====

    def upload_greeting_images(self, client: CdpClient, paths: Sequence[str]) -> str:
        """把本地临时文件作为一条图片消息发到当前会话；返回实际用到的策略名。

        失败一律抛 :class:`SiteFailure`（分类 ``file_upload_failed``）：调用方据此把这一支标成
        ``upload_failed``，但**不会**把投递判失败——文本早就送达了。
        """
        files = [str(path) for path in paths if str(path).strip()]
        if not files:
            raise SiteFailure(FAILURE_FILE_UPLOAD_FAILED, "没有可发送的图片文件")

        probe = self._probe_image_tools(client)
        baseline = int(probe.get("image_bubbles", 0) or 0)
        blocker = detect_blocker(probe)
        if blocker is not None:
            raise blocker_failure(blocker, probe)

        strategy = _STRATEGY_DOM_INPUT
        if not probe.get("input_found"):
            strategy = self._open_file_chooser(client, probe)
        # 到这里页面上必须有一个可用的 input；没有就是"形态不支持"，如实失败。
        if not self._probe_image_tools(client).get("input_found"):
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_missing_input(probe),
            )

        try:
            client.set_file_input(SELECTOR_FILE_INPUT, files)
        except CdpError as exc:
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                f"把图片交给页面上传控件时失败：{exc}。若浏览器里弹出了系统文件选择器，"
                "请手动选一次，或把这条诊断反馈给维护者（真站上传形态可能与实现不同）。",
            ) from exc

        self._confirm_if_needed(client)
        self._wait_image_bubble(client, baseline=baseline)
        logger.info("招呼语配图已发出，策略=%s", strategy)
        return strategy

    # ===== 内部步骤 =====

    def _probe_image_tools(self, client: CdpClient) -> dict[str, Any]:
        try:
            value = _as_payload(client.evaluate(_image_probe_script()))
        except CdpError as exc:
            # 页面正在重渲染 / 执行上下文被销毁：按"还没就绪"处理，交给等待循环重试。
            logger.debug("探测图片上传入口失败：%s", exc)
            value = {}
        return value if isinstance(value, dict) else {}

    def _open_file_chooser(self, client: CdpClient, probe: dict[str, Any]) -> str:
        """点一次「发送图片」，让页面把 file input 创建出来。

        先开 ``Page.setInterceptFileChooser``：它把"点击 → 系统文件选择器"拦成一个事件，
        页面不会弹原生对话框（原生对话框 CDP 关不掉，会一直挂在窗口前面）。个别内核不认这条
        命令（会抛 ``CdpError``），那种情况下仍然点——只是可能同时弹出选择器；诊断文案里会
        提一句"请手动选一次"，不假装我们知道点了以后一定发生什么。
        """
        intercepted = True
        try:
            client.send("Page.setInterceptFileChooser", {"enabled": True})
        except CdpError as exc:
            intercepted = False
            logger.info("当前内核不支持拦截文件选择器，将直接点击「发送图片」：%s", exc)

        rect = probe.get("send_rect")
        if not isinstance(rect, dict) or not rect:
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_missing_input(probe),
            )
        trusted_click(client, float(rect["x"]), float(rect["y"]))

        # 点完之后 input 可能是**异步**挂上的；给它一个就绪等待窗口，而不是 sleep。
        self._wait_state(
            client,
            {},
            _image_probe_script(),
            ready=lambda state: bool(state.get("input_found")),
            expected="「发送图片」点击后出现的文件上传控件",
        )
        return _STRATEGY_DOM_INPUT if intercepted else _STRATEGY_INTERCEPTED_CLICK

    def _confirm_if_needed(self, client: CdpClient) -> None:
        """预览态二次确认：**只在真的看到确认按钮时才点**。

        是否需要这一步真站未实测（见模块开头的三项）。所以这里既不假定它一定存在（找不到
        就什么都不做，直接等气泡），也不假定它不存在（出现了就点一次，否则图永远发不出去）。
        """
        probe = self._probe_image_tools(client)
        rect = probe.get("confirm_rect")
        if not isinstance(rect, dict) or not rect:
            return
        trusted_click(client, float(rect["x"]), float(rect["y"]))
        logger.info("图片预览态出现确认按钮，已点击一次")

    def _wait_image_bubble(self, client: CdpClient, *, baseline: int) -> None:
        """等**本人消息**里出现新的图片（数量超过上传前的基线）。

        判据是"图片气泡出现"，不是"点击成功"：站点接受点击不代表消息进了会话，而"发送图片"
        失败时页面通常毫无反馈。
        """

        def _probe() -> dict[str, Any]:
            try:
                value = _as_payload(client.evaluate(_bubble_script()))
            except CdpError:
                return {}
            return value if isinstance(value, dict) else {}

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                "已把图片交给页面，但没有看到图片消息出现在会话里。"
                f"当前地址：{state.get('url') or '未知'}；页面标题：{state.get('title') or '未知'}；"
                f"图片气泡数：{state.get('image_bubbles', 0)}（上传前 {baseline}）。"
                "请到浏览器里核对这条会话，并把这段诊断反馈给维护者。",
            )

        wait_for_page_state(
            _probe,
            is_ready=lambda state: int(state.get("image_bubbles", 0) or 0) > baseline,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    @staticmethod
    def _diagnose_missing_input(probe: dict[str, Any]) -> str:
        """找不到上传控件时的诊断：把人一眼能核对的三项写清楚。"""
        return (
            "聊天页上找不到可用的图片上传控件（页面里没有 input[type=file]，"
            "「发送图片」按钮也没能带出它）。"
            f"当前地址：{probe.get('url') or '未知'}；页面标题：{probe.get('title') or '未知'}；"
            f"匹配到的 input 数：{probe.get('input_count', 0)}；"
            f"「发送图片」入口按钮数：{probe.get('send_found', False)}。"
            "请把这段信息反馈给维护者，以便更新站点选择器（文本招呼语不受影响，已正常送达）。"
        )


__all__ = ["BossGreetingImageMixin"]
