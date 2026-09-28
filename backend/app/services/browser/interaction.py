"""对页面发起**可信**输入事件的共享原语。

## 为什么需要它

现代招聘站点普遍忽略合成事件：``element.click()`` 发出去的是 ``isTrusted=false``，
DOM 上事件照常冒泡，页面却毫无反应——**看起来成功了，实际什么都没发生**。
投递链路（``sites/boss_apply.py``）在 2026-09-20 为此刻意改用 CDP 的真实鼠标事件，
网申填表遇到的表单同样如此。这个模块把那套做法提出来，让两条链路共用一份实现。

## 为什么是自由函数，而不是 ``CdpClient`` 的方法

``apply/task_runner.py::StopAwareCdpClient`` 是 ``CdpClient`` 的包装，每次调用前插
停止/暂停检查点。它**只转发自己显式覆写的方法**——基类的其余方法给的是空实现或直接
转发不了，**漏了不会报错，只会静默失效**（离线测试全绿、生产不生效）。

把原语实现成"基于 ``client.send`` 的自由函数"，包装层不需要任何改动就自动成立，
从结构上避开了那个陷阱。**纪律**：以后凡是要新增到 ``CdpClient`` 抽象上的方法，
必须同时在 ``StopAwareCdpClient`` 显式转发，并补一条断言把它钉住。
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from .cdp_client import CdpClient, CdpError

logger = logging.getLogger(__name__)

# 真实输入事件的节拍：按下前先移动、移动与按下之间留一点间隔。
# 实测一次性把三种事件打出去，部分站点会判定为异常输入而忽略。
TRUSTED_CLICK_STEP_SECONDS = 0.06


def trusted_click(client: CdpClient, x: float, y: float) -> None:
    """在视口坐标 ``(x, y)`` 上发起可信鼠标点击（``Input.dispatchMouseEvent``）。

    点击前先做**窗口可见性保障**：窗口最小化/被遮挡/在其他虚拟桌面时，页面
    ``visibilityState`` 为 ``hidden``，站点会对点击静默忽略——事件 ``isTrusted=true``
    正常到达，页面毫无反应。``Page.bringToFront`` 与移动事件失败不致命；按下/抬起失败
    则向上抛（由调用方归类）。
    """
    try:
        client.send("Page.enable")
        client.send("Page.bringToFront")
    except CdpError:
        pass
    ensure = getattr(client, "ensure_page_visible", None)
    if ensure is not None and not ensure():
        # 无法还原窗口（无头/远程会话等）不在这里打死流程：继续点击并把情况写日志，
        # 真正点不动时由调用方的等待超时给出带 URL/标题的诊断。
        logger.warning("未能把浏览器窗口恢复到可见状态，点击可能不会生效")
    client.send(
        "Input.dispatchMouseEvent",
        {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0},
    )
    time.sleep(TRUSTED_CLICK_STEP_SECONDS)
    client.send(
        "Input.dispatchMouseEvent",
        {
            "type": "mousePressed",
            "x": x,
            "y": y,
            "button": "left",
            "buttons": 1,
            "clickCount": 1,
        },
    )
    time.sleep(TRUSTED_CLICK_STEP_SECONDS)
    client.send(
        "Input.dispatchMouseEvent",
        {
            "type": "mouseReleased",
            "x": x,
            "y": y,
            "button": "left",
            "buttons": 0,
            "clickCount": 1,
        },
    )


def element_center_script(selector: str) -> str:
    """取元素在**视口**中的中心坐标；顺带把它滚进视野。

    先用 ``scrollIntoView`` 再取 ``getBoundingClientRect``，所以返回的坐标已经反映了
    滚动后的位置。``behavior: 'instant'`` 是刻意的：站点若设了全局
    ``scroll-behavior: smooth``，平滑滚动还没结束就取坐标会拿到中间态。
    """
    return "".join(
        [
            "(() => { /* rf:click-rect */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            "  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });\n",
            "  const rect = el.getBoundingClientRect();\n",
            "  if (!rect.width || !rect.height) { return JSON.stringify({ ok: false, reason: 'invisible' }); }\n",
            "  return JSON.stringify({ ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });\n",
            "})()",
        ]
    )


def _parse_center(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            return None
    if not isinstance(payload, dict) or not payload.get("ok"):
        return None
    try:
        return {"x": float(payload["x"]), "y": float(payload["y"])}
    except (KeyError, TypeError, ValueError):
        return None


def click_selector(client: CdpClient, selector: str, *, timeout: float | None = None) -> bool:
    """点击 ``selector`` 命中的元素，走可信鼠标事件。返回是否真的点下去了。

    返回 ``False`` 的两种情况（元素不存在 / 元素不可见）由调用方如实上报，
    **不要**退化成合成 ``el.click()``——那正是这个模块要替代的做法。
    """
    center = _parse_center(client.evaluate(element_center_script(selector), timeout=timeout))
    if center is None:
        return False
    trusted_click(client, center["x"], center["y"])
    return True


__all__ = [
    "TRUSTED_CLICK_STEP_SECONDS",
    "click_selector",
    "element_center_script",
    "trusted_click",
]
