"""CDP 客户端：用 HTTP 端点 + WebSocket 与"投递专用浏览器"对话。

设计要点（决定了它为什么长这样）：

- **传输层可注入**。``WebsocketCdpClient`` 的 HTTP 走既有 ``httpx``，WebSocket 走
  ``websocket-client``；两者都通过构造参数注入（``http_transport`` / ``websocket_factory``），
  于是测试可以用假的传输层把整条链路离线跑起来，不启动真浏览器、不发真 CDP——这与
  LLM 层 ``create_provider(transport=httpx.MockTransport(...))`` 是同一个离线注入点思路。
- **所有调用都有超时**，异常统一收敛成 ``CdpError``，其 message 就是给用户看的中文提示。
- 只连**后端自己用独立 ``user-data-dir`` 拉起的那个浏览器**：Chrome 136+ 禁止在默认用户
  数据目录上开远程调试端口，所以不去碰用户日常浏览器。

本包由 base / window / websocket_client 组成，此 ``__init__`` 作为原 ``cdp_client``
模块路径的兼容门面：``__all__`` 与私有符号（``_default_websocket_factory`` /
``_MAX_FRAMES_PER_COMMAND`` / ``DEFAULT_HTTP_TIMEOUT``）以 ``import x as x`` 显式别名
保持原命名空间全集，全仓 41 处导入路径零改动。
"""
from __future__ import annotations

from .base import (
    DEFAULT_COMMAND_TIMEOUT as DEFAULT_COMMAND_TIMEOUT,
    DEFAULT_CONNECT_TIMEOUT as DEFAULT_CONNECT_TIMEOUT,
    DEFAULT_HOST as DEFAULT_HOST,
    DEFAULT_HTTP_TIMEOUT as DEFAULT_HTTP_TIMEOUT,
    _MAX_FRAMES_PER_COMMAND as _MAX_FRAMES_PER_COMMAND,
    CdpClient as CdpClient,
    CdpError as CdpError,
)
from .websocket_client import (
    WebsocketCdpClient as WebsocketCdpClient,
    _default_websocket_factory as _default_websocket_factory,
)
from .window import WindowAwareMixin as WindowAwareMixin

__all__ = [
    "CdpClient",
    "CdpError",
    "DEFAULT_COMMAND_TIMEOUT",
    "DEFAULT_CONNECT_TIMEOUT",
    "DEFAULT_HOST",
    "WebsocketCdpClient",
    "WindowAwareMixin",
]
