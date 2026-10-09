"""浏览器跨站防线：状态变更请求只接受回环来源。"""
from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

# 只拦"会改变状态"的方法：GET/HEAD/OPTIONS 天然放行——健康检查、静态资源、CORS
# 预检与 SSE（助手流式响应是 GET）都不受影响；WebSocket 的 scope["type"] 不是
# "http"，在入口判断处同样直接放行。
_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# 回环主机名集合：dev 下前端跑在 Vite dev server（5173），`/api` 经 vite 代理转发、
# 代理透传浏览器原始 `Origin: http://localhost:5173`；生产下前端由后端同源静态托管，
# Origin 是 `http://127.0.0.1:8005`。两者 host 都落在这三个回环名字上，天然放行；
# 恶意网页发来的 `Origin: https://evil.example` host 非回环，被拒。
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class LoopbackOriginGuardMiddleware:
    """对状态变更请求做回环 Origin 与 ``Sec-Fetch-Site`` 校验。

    威胁模型：后端只监听 ``127.0.0.1:8005``，但**回环监听与回环 IP 校验都挡不住
    浏览器 CSRF**——恶意网页借用户浏览器发请求时，TCP 对端就是 127.0.0.1，
    ``request.client.host`` 看起来仍是回环，任何"只允许本机连接"的既有防线都
    看不见它。这里在 HTTP 头层面补一道墙：

    - 带 ``Origin`` 的都是浏览器：Origin 的 host 不是回环 → 403；
    - ``Sec-Fetch-Site: cross-site`` 明确宣告了跨站 → 无论有无 Origin 一律 403
      （覆盖重定向链等会剥掉 Origin 头的浏览器场景）；
    - **无 Origin 的请求放行**：curl、启动器、TestClient 等非浏览器调用方没有
      Origin。刻意不做"必须带合法 Origin"的白名单式校验，否则全部本地自动化
      与数百个既有测试会被误伤——方案 B 的兼容性关键就在这条放行规则上。

    Origin 头存在但解析不出 hostname（畸形值、``null``）时**按 403 处理**：
    会带 Origin 的只有浏览器，畸形的 Origin 不会来自合法的本机前端。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method", "").upper() not in _MUTATING_METHODS:
            await self.app(scope, receive, send)
            return

        headers = {
            name.decode("latin-1").lower(): value.decode("latin-1")
            for name, value in scope.get("headers", [])
        }
        origin = headers.get("origin", "").strip()
        if origin:
            if not self._origin_is_loopback(origin):
                await self._reject(scope, send, origin)
                return
        elif headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
            await self._reject(scope, send, origin)
            return

        await self.app(scope, receive, send)

    @staticmethod
    def _origin_is_loopback(origin: str) -> bool:
        """判断 Origin 的 host 是否回环。

        ``urlparse(...).hostname`` 已做小写化、去端口、去 IPv6 括号；解析抛
        ``ValueError`` 或拿不到 hostname 时一律按**非回环**处理（见类 docstring）。
        """
        try:
            hostname = urlparse(origin).hostname
        except ValueError:
            return False
        if not hostname:
            return False
        return hostname.lower() in _LOOPBACK_HOSTS

    async def _reject(self, scope: Scope, send: Send, origin: str) -> None:
        """短路请求：返回 403 并留下含来源的诊断日志。"""
        path = scope.get("path", "")
        logger.warning(
            "已拒绝跨站状态变更请求：path=%s origin=%r", path, origin
        )
        body = json.dumps(
            {"detail": "拒绝跨站请求：本机后端只接受来自本机前端的状态变更操作"},
            ensure_ascii=False,
        ).encode("utf-8")
        message: Message = {
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
        await send(message)
        await send({"type": "http.response.body", "body": body})
