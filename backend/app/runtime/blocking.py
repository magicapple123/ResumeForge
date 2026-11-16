# SPDX-License-Identifier: Apache-2.0
"""把同步工作单元挪出事件循环的统一入口。

async 路由或 SSE 生成器里只要碰同步 SQLAlchemy（``get`` / ``commit`` / ``flush`` /
``refresh`` / ``query`` / ``execute``）、懒加载属性、文件 IO，就会占住事件循环线程：
同一进程里的其他请求、SSE 推送、健康检查全部排在它后面，而 SQLite 的
``busy_timeout=5000`` 意味着一次锁等待最长可以卡住 5 秒。

用法（**完整工作单元**，不要只搬一次 ``get``/``commit``）::

    dto = await run_sync(_prepare, db, payload, factory)
    # ... 这里可以 await 模型调用，期间不持有 Session ...
    await run_sync(_persist, factory, run_id, content)

纪律：

- 传进去的是**普通参数**（id、DTO、配置快照、session factory），不是懒加载的 ORM 对象；
  需要读关系的地方在 worker 内读完并物化成 DTO。
- 一个 Session 只在一个 worker 线程里串行使用；不要在 ``await`` 前后让事件循环也碰它。
- 长模型调用之前结束读事务；模型返回后用**冻结的数据集身份**开会话落库，不要重新读
  "当前全局活动数据集"（会落错库）。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from starlette.concurrency import run_in_threadpool

T = TypeVar("T")


async def run_sync(func: Callable[..., T], /, *args: object, **kwargs: object) -> T:
    """在线程池里执行 ``func(*args, **kwargs)``，事件循环只负责等待。"""
    return await run_in_threadpool(func, *args, **kwargs)


__all__ = ["run_sync"]
