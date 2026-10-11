"""LLM 传输层的进程级连接池（AI 提速）。

为什么要有这一层：两个 provider 的 ``_client()`` 原本**每次请求都新建**
``httpx.AsyncClient``——每个请求都要完整走一遍 TCP + TLS 握手（走代理时更贵），
日常 AI 功能（匹配分析、简历生成、对话）每次调用都白付几百毫秒。

现在两家 provider 共享这里缓存的客户端：同一事件循环、同一注入传输层的调用
复用同一连接池，连接在多次请求间保持。**超时不烘进客户端**——由每次请求经
``client.stream(..., timeout=...)`` 传入（read 预算按请求收紧的既有语义不变）。

键的设计：
- **事件循环**：httpx 连接绑定在创建它的事件循环上；测试与生产可能在不同循环里跑，
  键里带 loop 对象本身，换循环就换客户端。
- **注入传输层**：测试注入的 ``MockTransport`` 必须请求间隔离，按 transport 对象
  分键；生产为 ``None``，全部共享一个。

池有上限（防止测试里循环/传输对象频繁更替把池撑大）：超限时淘汰最早的条目。
被淘汰的客户端不主动 ``aclose()``——它可能属于别的（已关闭的）循环，跨循环收尾
只会制造新问题；交给 GC，MockTransport 无真实连接，生产只有一个真实客户端。
"""

from __future__ import annotations

import asyncio
from contextlib import suppress

import httpx

_MAX_CLIENTS = 8

_pool: dict[
    tuple[httpx.AsyncBaseTransport | None, asyncio.AbstractEventLoop], httpx.AsyncClient
] = {}


def get_shared_client(*, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """取（或建）当前事件循环下、该传输层对应的共享客户端。"""
    loop = asyncio.get_running_loop()
    # 键用**对象本身**而不是 id()：强引用同时防住"id 被回收后复用"的错配——
    # 用 id() 撞上一个已死亡循环的客户端，会把请求发进错误的事件循环。
    key = (transport, loop)
    client = _pool.get(key)
    if client is None:
        client = httpx.AsyncClient(transport=transport)
        _pool[key] = client
        if len(_pool) > _MAX_CLIENTS:
            for stale in [k for k in _pool if k != key][: len(_pool) - _MAX_CLIENTS]:
                _pool.pop(stale, None)
    return client


async def aclose_shared_clients() -> None:
    """收尾：关闭并清空池（应用关停时调用；测试里换循环前也可显式调用）。"""
    clients = list(_pool.values())
    _pool.clear()
    for client in clients:
        with suppress(Exception):  # 收尾路径绝不因单个客户端失败而中断
            await client.aclose()
