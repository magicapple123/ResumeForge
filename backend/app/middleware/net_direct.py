# SPDX-License-Identifier: Apache-2.0
"""请求级直连覆盖（T02）：``X-RF-Net-Direct: 1`` → 本次请求整条链路走直连。

为什么要一个中间件而不是给每个端点加参数：**出网路径是横切语义**。模型调用散落在
几十个服务里，如果"这次用直连"要靠参数一路透传，总有一处忘了接；而用户点「用直连重试」
时需要的正是"整条链路（含重试、含批量分片）都改走直连"。

实现要点：

- **纯 ASGI、同一个任务**：``contextvars`` 的写入因此能传到后续路由协程与流式响应
  的生成器里（换成 ``BaseHTTPMiddleware`` 会多一层任务，值是否可见取决于实现细节）；
- **只在命中请求头时写**：没有这个头的请求行为与引入本中间件之前逐字节一致；
- **``finally`` 里复位**：用户取消流式响应时也要复位，否则同一个上下文里的后续请求
  会莫名其妙地继承"直连"。

刻意**不做**的事：不记录、不校验来源（它只影响本机出网路径，没有越权面），
也不做"代理不可达自动直连"——那是另一回事，且等于静默改变用户的出网路径。
"""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from ..services import net_proxy


class NetDirectOverrideMiddleware:
    """把 ``X-RF-Net-Direct`` 请求头翻成 :data:`net_proxy.DIRECT_OVERRIDE`。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        raw = Headers(scope=scope).get(net_proxy.DIRECT_HEADER)
        if not net_proxy.parse_direct_header(raw):
            await self.app(scope, receive, send)
            return
        token = net_proxy.DIRECT_OVERRIDE.set(True)
        try:
            await self.app(scope, receive, send)
        finally:
            net_proxy.DIRECT_OVERRIDE.reset(token)


__all__ = ["NetDirectOverrideMiddleware"]
