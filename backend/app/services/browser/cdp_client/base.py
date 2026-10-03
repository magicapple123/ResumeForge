"""CDP 客户端公共基座：常量、``CdpError`` 与 ``CdpClient`` 抽象基类。"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_COMMAND_TIMEOUT = 30.0
DEFAULT_HTTP_TIMEOUT = 5.0
_MAX_FRAMES_PER_COMMAND = 5000


class CdpError(Exception):
    """对外暴露的 CDP 调用错误，message 为可直接展示给用户的中文提示。"""


class CdpClient(ABC):
    """页面级 CDP 客户端接口。

    业务层只依赖本抽象，不感知 HTTP / WebSocket 细节，因此可以用 ``FakeCdpClient``
    在离线测试里替换掉整条对外链路。
    """

    @abstractmethod
    def list_targets(self) -> list[dict[str, Any]]:
        """列出浏览器当前所有标签页（/json/list）。"""
        """列出浏览器里当前的调试目标（标签页 / 页面）。"""

    @abstractmethod
    def new_tab(self, url: str = "about:blank") -> str:
        """打开新标签页并返回 target id；Chrome 111+ 用 PUT，405 退 GET。"""
        """新建一个标签页并把它设为后续命令的目标，返回目标 id。"""

    @abstractmethod
    def send(
        self, method: str, params: dict[str, Any] | None = None, *, timeout: float | None = None
    ) -> dict[str, Any]:
        """发送一条 CDP 命令并返回其 ``result``。"""

    @abstractmethod
    def evaluate(self, expression: str, *, timeout: float | None = None) -> Any:
        """在页面里执行一段 JS 表达式并拿回值（awaitPromise，返回按值拷贝）。"""
        """在页面里执行一段脚本并返回按值传递的结果。"""

    # 事件订阅是**可选能力**，所以默认实现是"不支持"而不是 abstractmethod：
    # 站点适配器据此退回 DOM 解析（那本来就是保留的兜底路径），而假客户端与
    # 只做简单操作的实现不必为了满足抽象基类去写三个空方法。
    def start_event_capture(self, methods: Sequence[str]) -> None:
        """开始收集指定 CDP 方法的事件帧；不支持时什么都不做。"""
        return None

    def stop_event_capture(self) -> None:
        return None

    def drain_events(self) -> list[dict[str, Any]]:
        return []

    def close(self) -> None:
        """关闭底层连接（不关闭浏览器进程）。"""

