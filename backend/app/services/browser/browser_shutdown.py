# SPDX-License-Identifier: Apache-2.0
"""专用浏览器的三段式关闭：先请它自己退出，超时才升级到 terminate / kill。

**为什么不能直接 terminate**：Windows 上 ``Popen.terminate()`` 走 ``TerminateProcess``，
浏览器收不到任何关闭信号，也就不会走正常退出流程。Chromium 的 Cookie 存在
``Default/Network/Cookies``（SQLite，写入异步且带 journal），强杀会丢掉最近尚未落盘的
写入——最典型的时间窗正是"扫码登录成功后立刻关闭浏览器"，于是表现为偶发地丢登录态。

关闭顺序因此固定为：

1. 调试端口还在答时，先发 CDP ``Browser.close``（浏览器级关闭，比关标签页彻底）；
2. 等它自己退出（``GRACEFUL_EXIT_SECONDS``）；
3. 超时才 ``terminate()`` → 再等 ``ESCALATE_WAIT_SECONDS`` → 仍不退就 ``kill()``。

两条附加约束：

- **端口已经死了就直接跳到 terminate**。这时发不出 ``Browser.close``，干等那 3 秒只会让
  关闭按钮看起来"点了没反应"。
- **总预算 5 秒**（3 + 1.5 + 0.5）。关闭会在「关浏览器 / 切浏览器路径 / 退出应用」三条路径上
  被调用，任何一条都不能把界面拖成无响应。

**绝不按 PID 猜进程**：这里只操作调用方交进来的那个进程句柄（``owned`` 语义由调用方保证）。
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

GRACEFUL_EXIT_SECONDS = 3.0
ESCALATE_WAIT_SECONDS = 1.5
KILL_WAIT_SECONDS = 0.5

# 实际走的路径：只用于日志与测试断言（对外没有语义）。
SHUTDOWN_ALREADY_EXITED = "already-exited"
SHUTDOWN_GRACEFUL = "graceful"
SHUTDOWN_TERMINATED = "terminated"
SHUTDOWN_KILLED = "killed"


def wait_for_exit(process: Any, timeout: float) -> bool:
    """等进程退出最多 ``timeout`` 秒，返回它是否真的退了。

    ``Popen.wait(timeout=…)`` 超时抛 ``TimeoutExpired``；其它等待失败（句柄已失效等）同样
    按"没退出"处理——调用方据此升级到更强的手段，而不是在这里炸掉关闭流程。
    """
    try:
        process.wait(timeout=timeout)
    except Exception:  # noqa: BLE001 - 超时/句柄失效都按"还没退出"处理
        return False
    return process.poll() is not None


def request_browser_close(
    *,
    client_factory: Callable[..., Any],
    host: str,
    port: int,
    http_transport: Any = None,
) -> bool:
    """尽力发一次 CDP ``Browser.close``，返回是否送达。

    **失败不抛异常**：这里已经在"关不掉了"的路径上，多抛一个异常只会让调用方拿不到
    后面 terminate 的机会。真正的判据是进程有没有退（见 :func:`wait_for_exit`）。
    """
    client: Any | None = None
    try:
        # 先落到 Any 局部量再调方法：``client`` 声明成 `Any | None` 是给 finally 的
        # "造没造出来"判据用的，直接在它上面调方法会被 pyright 判成 Optional 成员访问。
        created: Any = client_factory(host, port, http_transport=http_transport)
        created.close_browser()
        client = created
        return True
    except Exception as exc:  # noqa: BLE001 - 关闭失败要降级，不能中断关闭流程
        logger.debug("CDP Browser.close 未送达：%s", type(exc).__name__)
        return False
    finally:
        if client is not None:
            with contextlib.suppress(Exception):
                client.close()


def shutdown_browser(
    process: Any,
    *,
    port_alive: Callable[[], bool],
    request_close: Callable[[], Any],
    graceful_seconds: float = GRACEFUL_EXIT_SECONDS,
    escalate_seconds: float = ESCALATE_WAIT_SECONDS,
    kill_seconds: float = KILL_WAIT_SECONDS,
) -> str:
    """按"CDP 优雅关闭 → 等 → terminate → 等 → kill"关闭，返回实际走的路径。"""
    if process.poll() is not None:
        return SHUTDOWN_ALREADY_EXITED
    if port_alive():
        request_close()
        if wait_for_exit(process, graceful_seconds):
            return SHUTDOWN_GRACEFUL
        logger.info("浏览器未在 %.1fs 内自行退出，升级为终止", graceful_seconds)
    process.terminate()
    if wait_for_exit(process, escalate_seconds):
        return SHUTDOWN_TERMINATED
    process.kill()
    wait_for_exit(process, kill_seconds)
    return SHUTDOWN_KILLED


__all__ = [
    "ESCALATE_WAIT_SECONDS",
    "GRACEFUL_EXIT_SECONDS",
    "KILL_WAIT_SECONDS",
    "SHUTDOWN_ALREADY_EXITED",
    "SHUTDOWN_GRACEFUL",
    "SHUTDOWN_KILLED",
    "SHUTDOWN_TERMINATED",
    "request_browser_close",
    "shutdown_browser",
    "wait_for_exit",
]
