# SPDX-License-Identifier: Apache-2.0
"""「客户端断开就真的取消」的共享实现（短任务端点用）。

## 为什么需要它

任务化只适合"跑几十秒到几分钟、用户会离开"的入口。像「选中一段话 → 立刻给三个改写选项」
这种 1–3 秒的调用**不该**建任务：建任务 + 1.5 秒轮询 + 一张通知的开销比收益大，而且结果
必须当场回填到用户正在编辑的那一栏——人走了，回填目标也没了。

它们仍然需要**能中途取消**。而 ``async def`` 本身并不保证这件事：客户端 abort 之后，
ASGI 服务不会自动把 handler 的协程掐掉，它会**照旧把整段生成跑完并继续烧 token**，
只是那份响应没人收。

所以这里做的就是缺的那一步：一边跑协程，一边盯 ``request.is_disconnected()``。

## 与任务化的分工

- 长任务：``services/ai_task_runner``（后台线程 + 跨线程取消 + 终态仲裁）；
- 短任务：本模块（同一个请求内跑完，断开即取消，没有任务表）。

两条路的取消语义**是同一条**：用户喊停之后，后端不再继续花钱。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from contextlib import suppress
from typing import TypeVar

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

T = TypeVar("T")

# 轮询客户端是否还连着的间隔：0.4s 足够让「点了取消」立刻停掉生成，
# 又不会把一次 60s 的调用变成上万次 is_disconnected 调用。
DISCONNECT_POLL_SECONDS = 0.4


async def run_until_disconnect(
    request: Request,
    coro: Awaitable[T],
    poll_interval: float = DISCONNECT_POLL_SECONDS,
    *,
    what: str = "生成",
) -> T | None:
    """跑一个协程，同时盯着客户端是否还连着；断开就取消它并返回 ``None``。

    为什么不只是"跑完再问一次"：那样用户点了取消之后，服务端仍然把整段生成跑完、
    照样烧 token——前端的 abort 只停掉了自己那一侧的等待。

    **第一轮先判断一次断开**再进入等待：客户端在请求刚发出就跑了的情况下，协程不会先
    白跑一个轮询周期。协程一律先 ``create_task`` 成任务，取消时 ``await`` 它收尾，
    保证没有"创建了却没人持有"的协程。
    """
    task = asyncio.create_task(coro)  # type: ignore[arg-type]  # 泛型协程
    try:
        while True:
            if await request.is_disconnected():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                logger.info("客户端已断开，已取消本次%s", what)
                return None
            done, _ = await asyncio.wait({task}, timeout=poll_interval)
            if done:
                return task.result()
    finally:
        # 任何提前返回/异常路径都不留下孤儿任务。
        if not task.done():
            task.cancel()


async def run_or_gone(
    request: Request,
    coro: Awaitable[T],
    poll_interval: float = DISCONNECT_POLL_SECONDS,
    *,
    what: str = "生成",
) -> T:
    """同 ``run_until_disconnect``，但客户端断开时直接抛 499 而不是返回 ``None``。

    给"客户端走了就彻底没事可做"的端点用（深挖的判定/复盘/复练题、招呼语预览……）：
    它们本来就不需要"断开后换个兜底结果"，所以调用方不必每次手写一遍
    ``if result is None``——写漏一处就会退化成"客户端已经走了，服务端还在算兜底结果"。
    """
    result = await run_until_disconnect(request, coro, poll_interval, what=what)
    if result is None:
        raise client_gone(what)
    return result


def client_gone(what: str = "生成") -> HTTPException:
    """499：客户端已经走了，没人收这个响应。

    ``detail`` 只写原因（"请…"这类引导属于前端 ``errorGuidance`` 的职责），而且这句话
    正常情况下用户看不到——他的 abort 已经先落地了。
    """
    return HTTPException(status_code=499, detail=f"客户端已断开，本次{what}未完成")


__all__ = ["DISCONNECT_POLL_SECONDS", "client_gone", "run_or_gone", "run_until_disconnect"]
