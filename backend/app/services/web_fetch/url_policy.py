# SPDX-License-Identifier: Apache-2.0
"""抓取前的 URL 安全校验（SSRF 防护）与同域限速。

**为什么单独一层**：抓取入口有两个（岗位广场「从链接导入」与助手工具），两条路径都必须
在**发起请求之前**、以及**每一次重定向之后**做同一套校验。把判据写在一个模块里，规则只
需要改一处；如果让每个引擎各写一份，迟早出现「http 引擎拦了、浏览器引擎没拦」的缺口。

防护口径（按 #16A 的硬门槛）：

- 只允许 http / https，且只允许标准端口（80/443）——非标准端口是内网服务的典型入口，
  即席抓取没有理由需要它；
- 域名解析后对**每一个** IP 校验，拒绝回环 / 私有 / 链路本地 / 元数据 / 保留 / 组播地址；
  解析出多个 IP 时任何一个不合格就整条拒绝（否则 DNS 轮询可绕过）；
- 错误文案只说明「这个链接不允许抓取」，**不把解析出的内网 IP 或端口带出去**——错误会进
  模型上下文、SSE 与日志。

本模块不做任何网络请求（除 DNS 解析），可完全离线测试。
"""

from __future__ import annotations

import ipaddress
import socket
import time
from collections.abc import Callable
from urllib.parse import urlsplit

#: 只允许的协议。
ALLOWED_SCHEMES = ("http", "https")
#: 协议 → 允许的端口（只允许默认端口）。
ALLOWED_PORTS = {"http": 80, "https": 443}
#: URL 长度上限（超出多半是数据拼接错误，不是真实链接）。
MAX_URL_LENGTH = 2048

_REJECT_MESSAGE = "这个链接不允许抓取：只支持公开的 http/https 页面"
_PORT_MESSAGE = "这个链接不允许抓取：只支持标准端口（http 的 80、https 的 443）"


class UrlRejected(ValueError):
    """URL 被安全策略拒绝。

    str(exc) 是可直接展示给用户/模型的文案；调用方不要再拼接解析细节。
    """


def reject(message: str = _REJECT_MESSAGE) -> UrlRejected:
    return UrlRejected(message)


def is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """判断一个 IP 是否属于可以公开访问的地址。"""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        # IPv4-mapped（::ffff:127.0.0.1）要按 IPv4 判，否则回环可绕过。
        ip = ip.ipv4_mapped
    return not (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_url_syntax(url: str) -> str:
    """校验并归一化 URL 形状；不通过时抛 UrlRejected。

    只做「不需要 DNS」的检查：协议、主机、端口、userinfo。DNS 在
    resolve_and_check 里做（测试可注入解析器，避免依赖外网）。
    """
    text = (url or "").strip()
    if not text:
        raise reject("请提供要抓取的链接")
    if len(text) > MAX_URL_LENGTH:
        raise reject("链接太长，无法抓取")
    try:
        parts = urlsplit(text)
    except ValueError as exc:  # 非法 IPv6 字面量等
        raise reject() from exc
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise reject("这个链接不允许抓取：只支持 http/https 链接")
    host = parts.hostname or ""
    if not host:
        raise reject("这个链接缺少域名，无法抓取")
    if parts.username or parts.password:
        # URL 里带凭据是钓鱼/绕过常见手法，且会把秘密写进日志。
        raise reject()
    try:
        port = parts.port
    except ValueError as exc:
        raise reject(_PORT_MESSAGE) from exc
    if port is not None and port != ALLOWED_PORTS[scheme]:
        raise reject(_PORT_MESSAGE)
    normalized = parts._replace(scheme=scheme, fragment="").geturl()
    return normalized


def _literal_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """host 本身是 IP 字面量时解析出来，否则返回 None。"""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def resolve_host_ips(host: str, port: int) -> list[str]:
    """解析域名到 IP 列表（测试通过 monkeypatch 它来离线跑）。"""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses: list[str] = []
    for info in infos:
        sockaddr = info[4]
        if sockaddr and sockaddr[0] not in addresses:
            addresses.append(str(sockaddr[0]))
    if not addresses:
        raise UrlRejected("这个链接的域名无法解析，抓不到页面")
    return addresses


def resolve_and_check(url: str, *, resolver: Callable[[str, int], list[str]] | None = None) -> str:
    """协议/端口检查之后再解析域名，逐 IP 校验；返回可抓取的 URL。"""
    normalized = validate_url_syntax(url)
    parts = urlsplit(normalized)
    host = parts.hostname or ""
    port = parts.port or ALLOWED_PORTS[parts.scheme]
    literal = _literal_ip(host)
    addresses = (
        [str(literal)] if literal is not None else (resolver or resolve_host_ips)(host, port)
    )
    for raw in addresses:
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            raise reject() from None
        if not is_public_ip(ip):
            # 注意：这里刻意不提是哪个地址，也不提具体端口——错误会进模型上下文与日志。
            raise UrlRejected("这个链接指向本机或内网地址，出于安全考虑不允许抓取")
    return normalized


class HostRateLimiter:
    """同域名请求间隔限制（默认 ≥2s）。

    单任务内使用；时间源与 sleeper 可注入，测试用假时钟即可离线跑。
    """

    def __init__(
        self,
        *,
        min_interval: float = 2.0,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._min_interval = max(min_interval, 0.0)
        self._clock = clock
        self._sleep = sleeper
        self._last: dict[str, float] = {}

    def wait(self, host: str) -> float:
        """必要时睡眠到允许发请求的时刻；返回实际等待秒数。"""
        key = (host or "").lower()
        if not key or self._min_interval <= 0:
            return 0.0
        now = self._clock()
        last = self._last.get(key)
        wait_for = 0.0 if last is None else max(0.0, self._min_interval - (now - last))
        if wait_for > 0:
            self._sleep(wait_for)
            now = self._clock()
        self._last[key] = now
        return wait_for


__all__ = [
    "ALLOWED_PORTS",
    "ALLOWED_SCHEMES",
    "MAX_URL_LENGTH",
    "HostRateLimiter",
    "UrlRejected",
    "is_public_ip",
    "resolve_and_check",
    "resolve_host_ips",
    "validate_url_syntax",
]
