# SPDX-License-Identifier: Apache-2.0
"""``BrowserManager`` 的生命周期挂钩协议（L1 会话续期 / K2 BOSS 保活挂在这里）。

为什么要有这一层：这两件事都必须在"浏览器进入 running 之后"和"关闭浏览器之前"各做一次，
但它们跟"拉起进程、探端口"没有关系。直接写进 ``BrowserManager`` 会让那个已经贴到
500 行预算的文件继续增长，也会让"关闭顺序"这种关键约束散落在两处。

约定：

- ``on_running(manager)``：浏览器可用之后调用，**可重复调用**（要幂等，线程只起一次）；
- ``on_stopping(manager)``：``BrowserManager.stop()`` 在发 CDP ``Browser.close`` **之前**
  调用。L1 的"最后一次续期"就落在这里，于是关闭顺序天然是
  「停线程 → 最后一次续期 → Browser.close」。

挂钩里的异常一律吞掉并记 warning：挂钩失败不该让"启动/关闭浏览器"失败。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class BrowserLifecycleHook(Protocol):
    """浏览器生命周期挂钩。``manager`` 是 ``BrowserManager``（用 Any 避免循环导入）。"""

    def on_running(self, manager: Any) -> None:
        """浏览器进入 running（幂等）。"""
        ...

    def on_stopping(self, manager: Any) -> None:
        """即将关闭浏览器（此时调试端口还能用）。"""
        ...


def notify_running(hooks: Sequence[BrowserLifecycleHook], manager: Any) -> None:
    """按注册顺序通知挂钩"浏览器起来了"。"""
    for hook in hooks:
        try:
            hook.on_running(manager)
        except Exception:  # noqa: BLE001 - 挂钩失败不能挡住启动
            logger.warning("浏览器启动挂钩执行失败 hook=%s", type(hook).__name__, exc_info=True)


def notify_stopping(hooks: Sequence[BrowserLifecycleHook], manager: Any) -> None:
    """按注册顺序通知挂钩"要关了"。

    **必须在 CDP ``Browser.close`` 之前调用**：L1 的收尾续期要趁调试端口还活着发出去。
    """
    for hook in hooks:
        try:
            hook.on_stopping(manager)
        except Exception:  # noqa: BLE001 - 挂钩失败不能挡住关闭
            logger.warning("浏览器关闭挂钩执行失败 hook=%s", type(hook).__name__, exc_info=True)


__all__ = ["BrowserLifecycleHook", "notify_running", "notify_stopping"]
