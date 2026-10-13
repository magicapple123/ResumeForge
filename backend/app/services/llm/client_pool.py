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
**淘汰必须在其所属循环内关闭**（审计 PR-08，修复前只丢引用、连接悬挂到 GC）：
- 属于当前循环 → 直接调度 ``aclose`` 任务；
- 属于其他仍在运行的循环 → ``run_coroutine_threadsafe`` 投递关闭（fire-and-forget，
  ``get()`` 保持同步、不阻塞）；循环已停/已关则放弃——该客户端已不可用，连接随
  循环消亡。
  取舍说明：没有选"待关闭清单 + 下次复用点清理"，因为它要求每个使用点都记得
  触发清理，漏一处就是泄漏；``run_coroutine_threadsafe`` 由 httpx 客户端自身的
  循环语义保证安全（aclose 只跑在创建它的循环上），复杂度更低、正确性更强。
  **绝不跨循环直接 await**——那是把连接关闭跑在错误循环上的事故源。

cookies 隔离策略（审计 PR-08）：池里的客户端会在不同 provider / 模型 / 用户配置
之间轮换复用，httpx 默认把响应里的 Set-Cookie 存进客户端并在后续请求自动带上
（``cookies=None`` **并不**禁用持久化，只是"空罐起步"）。这里从根上禁用入站
持久化：罐永远为空，出站请求（build_request 按 jar 合并 Cookie 头）自然也不会
带任何存量 cookie。Authorization/ApiKey 头本来就走每请求注入（headers 参数），
不落客户端状态。
"""

from __future__ import annotations

import asyncio
import http.cookiejar
import logging
from contextlib import suppress

import httpx

logger = logging.getLogger(__name__)

_MAX_CLIENTS = 8

_pool: dict[
    tuple[httpx.AsyncBaseTransport | None, asyncio.AbstractEventLoop], httpx.AsyncClient
] = {}


class _NoPersistenceJar(http.cookiejar.CookieJar):
    """不存储任何响应 Cookie 的空 Cookie 罐（PR-08 cookie 隔离，见模块说明）。"""

    def extract_cookies(self, cookiejar, request):  # type: ignore[override]
        # 刻意忽略 Set-Cookie：共享池里不保存任何跨请求会话状态。
        # （httpx.Cookies 的构造器会复制/包装传入的 Cookies 实例，直接传 jar
        # 对象才会被原样持有——所以隔离做在 cookiejar 这一层。）
        return None


def _new_shared_client(transport: httpx.AsyncBaseTransport | None) -> httpx.AsyncClient:
    client = httpx.AsyncClient(transport=transport)
    # cookies 隔离（PR-08）：罐永远为空 → 出站请求不带任何存量 Cookie；
    # 入站 Set-Cookie 落不进罐。Authorization/ApiKey 头本来就走每请求注入。
    # 注意要传 jar 本体：传 httpx.Cookies 实例会被 setter 再包一层、丢掉自定义 jar。
    client.cookies = _NoPersistenceJar()
    return client


async def _aclose_quietly(client: httpx.AsyncClient) -> None:
    with suppress(Exception):  # 收尾路径绝不因单个客户端失败而中断
        await client.aclose()


def _evict(key: tuple[httpx.AsyncBaseTransport | None, asyncio.AbstractEventLoop]) -> None:
    """淘汰一个池条目，并在**其所属循环**内关闭客户端（PR-08，取舍见模块说明）。"""
    client = _pool.pop(key, None)
    if client is None:
        return
    current_loop = asyncio.get_running_loop()
    stale_loop = key[1]
    if stale_loop is current_loop:
        current_loop.create_task(_aclose_quietly(client))
        return
    if stale_loop.is_closed():
        # 循环已关闭：连接早已随循环消亡，客户端只剩待 GC 的空壳。
        return
    try:
        asyncio.run_coroutine_threadsafe(_aclose_quietly(client), stale_loop)
    except RuntimeError:
        logger.debug("连接池淘汰：目标事件循环已不可用，放弃关闭 %r", client)


def get_shared_client(*, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """取（或建）当前事件循环下、该传输层对应的共享客户端。"""
    loop = asyncio.get_running_loop()
    # 键用**对象本身**而不是 id()：强引用同时防住"id 被回收后复用"的错配——
    # 用 id() 撞上一个已死亡循环的客户端，会把请求发进错误的事件循环。
    key = (transport, loop)
    client = _pool.get(key)
    if client is None:
        client = _new_shared_client(transport)
        _pool[key] = client
        if len(_pool) > _MAX_CLIENTS:
            for stale in [k for k in _pool if k != key][: len(_pool) - _MAX_CLIENTS]:
                _evict(stale)
    return client


async def aclose_clients_for_current_loop() -> None:
    """关闭并移除属于**当前事件循环**的池内客户端（PR-08）。

    ``asyncio.run`` 的后台任务循环（如简历生成 runner 的每任务新循环）在关闭前
    调用：该循环一旦关闭，池里残留的该循环客户端既不能被复用也无法被安全关闭。
    其他循环的条目一律不碰。
    """
    loop = asyncio.get_running_loop()
    stale = [key for key in _pool if key[1] is loop]
    for key in stale:
        client = _pool.pop(key, None)
        if client is not None:
            await _aclose_quietly(client)


async def aclose_shared_clients() -> None:
    """收尾：关闭并清空池（应用关停时调用；测试里换循环前也可显式调用）。

    当前循环的条目就地关闭；其他仍在运行的循环经 ``run_coroutine_threadsafe``
    投递关闭（fire-and-forget），已关闭的循环直接放弃。
    """
    current_loop = asyncio.get_running_loop()
    entries = list(_pool.items())
    _pool.clear()
    for key, client in entries:
        loop = key[1]
        if loop is current_loop:
            await _aclose_quietly(client)
            continue
        if loop.is_closed():
            continue
        with suppress(RuntimeError):
            asyncio.run_coroutine_threadsafe(_aclose_quietly(client), loop)
