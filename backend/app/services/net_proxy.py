# SPDX-License-Identifier: Apache-2.0
"""出网路径：代理来源解析、直连覆盖、连接池代际（T02）。

改造前"用不用代理"不可见：来源可能是环境变量、Windows 注册表或 macOS 系统设置，
用户不知道请求走了哪条路，错误文案也就只会说「无法连接模型服务」。

本模块只做三件事，**都不含业务语义**：

- :func:`resolve_proxy`：按 httpx 的顺序解析（env 大小写都认 → 系统/注册表），并把
  **回环目标强制直连**（127.0.0.0/8、``::1``、localhost、``*.localhost``）——本地模型
  与 CDP 探测不能因为"这台机器装了 Clash"而失败；
- :class:`ProxyInfo`：可脱敏的代理描述（``redacted()`` / ``fingerprint()`` **都不含凭据**）；
- 请求级直连覆盖（``X-RF-Net-Direct``）与连接池代际：改设置后下一次调用即换新客户端。

拆出去的两个同级模块（2026-11 拆文件，原文件 831 行超预算）：

- :mod:`app.services.net_tls`：异常 → 人话（socks / 证书四细分 / 代理在用时的措辞）；
- :mod:`app.services.net_client`：**唯一**的 httpx 客户端工厂（``trust_env=False``）。
  本模块末尾把它们 re-export，既有 ``net_proxy.build_client`` 等调用点零改动。

三条硬约束（违反即返工）：不在 import 期读环境变量/注册表（都可注入）；socks 只做
"明确报错 + 引导用 http:// 代理"，不装 ``httpx[socks]``、不自动降级直连；非 socks 的
``ImportError`` 原样抛出（那是代码缺陷，不是网络问题）。
"""

from __future__ import annotations

import ipaddress
import logging
import os
import threading
import urllib.request
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from urllib.parse import urlsplit

from . import net_settings
from .net_proxy_types import (
    NET_PATH_DIRECT,
    SOURCE_CUSTOM,
    SOURCE_DIRECT,
    SOURCE_ENV,
    SOURCE_LABELS,
    SOURCE_LOOPBACK,
    SOURCE_OVERRIDE,
    SOURCE_REGISTRY,
    SOURCE_SYSTEM,
    ProxyConfigurationError,
    ProxyInfo,
    SocksProxyUnsupported,
)

logger = logging.getLogger(__name__)

# ===== 来源标识 / 代理描述 =====
#
# 类型层已拆到 :mod:`app.services.net_proxy_types`（2026-11-21，本文件 498 行贴住 500 行
# 预算、零豁免）：上面逐个 import 回来，`__all__` 照旧列出，因此既有调用点
# （12+ 处 `from . import net_proxy` 后取 `net_proxy.ProxyInfo` / `net_proxy.SOURCE_*`）
# 一行都不用改。解析与出网决策（判定顺序、环境变量、注册表、直连覆盖）仍在下面。

# 环境变量的解析顺序（与 httpx 的 per-scheme 优先级对齐：HTTPS 请求先看 https_proxy）。
# 每个变量大小写都认；同名时大写优先（多数工具写大写，读写顺序固定便于断言）。
ENV_PROXY_VARS: tuple[tuple[str, str], ...] = (
    ("HTTPS_PROXY", "https_proxy"),
    ("HTTP_PROXY", "http_proxy"),
    ("ALL_PROXY", "all_proxy"),
)
NO_PROXY_VARS: tuple[str, str] = ("NO_PROXY", "no_proxy")

# ===== 请求级直连覆盖 =====

DIRECT_HEADER = "X-RF-Net-Direct"
"""请求头：带 ``1`` 时本次请求**整条链路**走直连（前端只在"用直连重试"按钮上带一次）。"""

DIRECT_OVERRIDE: ContextVar[bool] = ContextVar("rf_net_direct_override", default=False)
"""请求级直连开关。由中间件按请求头写入，工厂读取——不写进任何全局状态。"""

# ===== 错误分类（与 ``LLMError.net_path`` 同一套字面量）=====
#
# ``NET_PATH_DIRECT`` 的值在 net_proxy_types（它是 ``ProxyInfo.fingerprint`` 的直连返回值，
# 与描述类型放在一起才不会被改单边），顶部已 import 回来；其余几条与 net_tls 的错误分类
# 绑定，留在这里。

NET_PATH_PROXY_REFUSED = "proxy_refused"
NET_PATH_PROXY_SOCKS = "proxy_socks_unsupported"
NET_PATH_TLS = "tls_untrusted"
NET_PATH_CONNECT = "connect"
NET_PATH_TIMEOUT = "timeout"

# 既有的两条文案（改造前写死在每个 provider 里）。``connect`` / ``timeout`` 沿用它们，
# 只在"确实经过了代理"时追加一句可操作的出路，避免把老用户熟悉的句子改掉。
CONNECT_MESSAGE = "无法连接模型服务，请检查 Base URL 与网络状态"
TIMEOUT_MESSAGE = "模型响应超时，请稍后重试或调大超时时间"

#: 分类 → 文案。键与 ``LLMError.net_path`` 一致（前端按它决定要不要显示"用直连重试"）。
NET_PATH_LABELS: dict[str, str] = {
    NET_PATH_DIRECT: "直连",
    NET_PATH_PROXY_REFUSED: "代理连接失败",
    NET_PATH_PROXY_SOCKS: "不支持 socks 代理",
    NET_PATH_TLS: "证书校验失败",
    NET_PATH_CONNECT: "连接失败",
    NET_PATH_TIMEOUT: "超时",
}

_SOCKS_IMPORT_MARKER = "socksio"


# ===== 描述类型 =====
#
# ``ProxyConfigurationError`` / ``SocksProxyUnsupported`` / ``ProxyInfo`` 与 ``_safe_split``
# 都在 net_proxy_types（顶部 import 回来）。这里留空是因为下一段就是解析逻辑——不要再在
# 本文件重新定义一份，那会让 `except net_proxy.SocksProxyUnsupported` 抓不到工厂抛的那一个。


# ===== 回环判定 =====

_LOOPBACK_NAMES = frozenset({"localhost", "localhost.localdomain", "ip6-localhost"})


def is_loopback_host(host: str) -> bool:
    """主机名是否是回环（127.0.0.0/8、``::1``、localhost、``*.localhost``）。

    直接写字面 IP 与写 ``localhost`` 一样常见（``localhost:11434`` 是 Ollama 的默认
    地址），所以两条都要认。``*.localhost`` 是 RFC 6761 保留的"一定是本机"后缀。
    """
    text = (host or "").strip().strip("[]").split("%", maxsplit=1)[0].lower()
    if not text:
        return False
    if text in _LOOPBACK_NAMES or text.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        return False
    if address.is_loopback:
        return True
    mapped = getattr(address, "ipv4_mapped", None)
    return mapped is not None and mapped.is_loopback


def is_loopback_url(url: str) -> bool:
    """URL 的主机是否是回环（解析不出主机时按"不是"处理）。"""
    if not url:
        return False
    try:
        parts = urlsplit(url if "://" in url else f"http://{url}")
    except ValueError:
        return False
    return is_loopback_host(parts.hostname or "")


def _host_of(url: str) -> str:
    try:
        return urlsplit(url if "://" in url else f"http://{url}").hostname or ""
    except ValueError:
        return ""


# ===== 直连覆盖 =====


def direct_override_active() -> bool:
    """本次请求是否被显式要求直连（中间件按请求头写入）。"""
    return DIRECT_OVERRIDE.get()


def parse_direct_header(value: str | None) -> bool:
    """``X-RF-Net-Direct`` 的取值判定。只有 ``1`` / ``true`` 算数，其余一律忽略。"""
    return (value or "").strip().lower() in {"1", "true"}


@contextmanager
def force_direct(enabled: bool = True) -> Iterator[None]:
    """在本作用域内强制直连（测试与"用直连重试"的编排都用它）。"""
    token = DIRECT_OVERRIDE.set(enabled)
    try:
        yield
    finally:
        DIRECT_OVERRIDE.reset(token)


# ===== 连接池 generation =====

_generation_lock = threading.Lock()
_generation = 0


def generation() -> int:
    """当前池 generation：改一次网络设置就 +1，池键随之变化 → **不重启即生效**。"""
    return _generation


def bump_generation() -> int:
    """让所有既有池条目失效（旧客户端留给淘汰逻辑收尾，不在这里关）。"""
    global _generation
    with _generation_lock:
        _generation += 1
        return _generation


# ===== 解析 =====


def _proxy_from_env(env: Mapping[str, str]) -> ProxyInfo | None:
    for upper, lower in ENV_PROXY_VARS:
        for name in (upper, lower):
            value = (env.get(name) or "").strip()
            if value:
                return ProxyInfo(url=_with_scheme(value), source=SOURCE_ENV, var=name)
    return None


def _with_scheme(value: str) -> str:
    """``127.0.0.1:7890`` 这种"只有 host:port"的值按 http 补全（httpx 也是这么做的）。"""
    return value if "://" in value else f"http://{value}"


def _system_proxies_default() -> dict[str, str]:
    """系统代理（Windows 走注册表、macOS 走系统设置，Linux 通常为空）。"""
    try:
        proxies = dict(urllib.request.getproxies())
    except Exception:  # noqa: BLE001 - 读注册表失败不该让整个请求失败
        return {}
    # Windows 上 ``getproxies()`` = ``getproxies_environment() or getproxies_registry()``：设过
    # ``NO_PROXY`` 的人（配过 CLI 代理的常见）会让环境那半返回非空 ``{'no': ...}``，``or``
    # 短路、注册表永远读不到——明明开着系统代理也被判成直连。故一个可用 scheme 键都没有时
    # 补读注册表（非 Windows 没有这个函数，默认 reader 是 dict，调用得空表）。
    if not any(proxies.get(key) for key in ("https", "http", "all", "socks")):
        with suppress(Exception):  # 第二来源失败就沿用上面的结果
            proxies.update(dict(getattr(urllib.request, "getproxies_registry", dict)()))
    return {str(key): str(value) for key, value in dict(proxies).items() if value}


def _proxy_from_system(proxies: Mapping[str, str]) -> ProxyInfo | None:
    for key in ("https", "http", "all", "socks"):
        value = (proxies.get(key) or "").strip()
        if value:
            source = SOURCE_REGISTRY if os.name == "nt" else SOURCE_SYSTEM
            return ProxyInfo(url=_with_scheme(value), source=source, var=f"getproxies:{key}")
    return None


def _no_proxy_hit(url: str, env: Mapping[str, str]) -> bool:
    """``NO_PROXY`` 命中判断（只支持最常见的三形态：``*`` / 精确主机 / ``.后缀``）。"""
    raw = ""
    for name in NO_PROXY_VARS:
        if (env.get(name) or "").strip():
            raw = (env.get(name) or "").strip()
            break
    if not raw:
        return False
    host = _host_of(url).lower()
    if not host:
        return False
    for entry in (item.strip().lower() for item in raw.split(",")):
        if not entry:
            continue
        if entry == "*":
            return True
        entry_host = entry.lstrip(".").split(":", maxsplit=1)[0]
        if not entry_host:
            continue
        if entry.startswith("."):
            if host == entry_host or host.endswith(f".{entry_host}"):
                return True
        elif host == entry_host:
            return True
    return False


def resolve_proxy(
    *,
    target_url: str | None = None,
    env: Mapping[str, str] | None = None,
    system_proxies: Callable[[], Mapping[str, str]] | None = None,
    settings: net_settings.NetworkSettings | None = None,
) -> ProxyInfo:
    """解析本次请求该走哪条出网路径。

    判定顺序（顺序本身是契约，测试逐条钉住）：

    1. 请求级直连覆盖（``X-RF-Net-Direct``）——最高优先级，"用直连重试"靠它；
    2. **回环目标强制直连**——本地模型与 CDP 探测不受任何代理影响；
    3. 设置里的 ``proxy_mode``：``direct`` 直接返回；``custom`` 用用户填的地址；
    4. 环境变量（``HTTPS_PROXY`` → ``HTTP_PROXY`` → ``ALL_PROXY``，大小写都认）；
    5. 系统代理（Windows 注册表 / macOS 系统设置）；
    6. 都没有 → 直连。

    Args:
        target_url: 本次要访问的地址。缺省（None）表示"不知道该访问谁"，此时不做
            回环与 ``NO_PROXY`` 判定——调用方应尽量传真实端点。
        env: 环境变量映射（默认 ``os.environ``，测试注入用）。
        system_proxies: 系统代理读取器（默认 ``urllib.request.getproxies``，测试注入用）。
        settings: 网络设置快照（默认读 ``net_settings.current()``）。
    """
    if direct_override_active():
        return ProxyInfo(url=None, source=SOURCE_OVERRIDE, var=DIRECT_HEADER)
    if target_url and is_loopback_url(target_url):
        return ProxyInfo(url=None, source=SOURCE_LOOPBACK, var=_host_of(target_url))
    current_settings = net_settings.current() if settings is None else settings
    if current_settings.mode == net_settings.PROXY_MODE_DIRECT:
        return ProxyInfo(url=None, source=SOURCE_DIRECT, var="network.proxy_mode")
    if current_settings.mode == net_settings.PROXY_MODE_CUSTOM:
        runtime = current_settings.runtime_url()
        if not runtime:
            # 选了自定义却没填地址：等于直连，但把来源标清楚，别让用户以为代理生效了。
            return ProxyInfo(url=None, source=SOURCE_DIRECT, var="network.proxy_url")
        return ProxyInfo(url=runtime, source=SOURCE_CUSTOM, var="network.proxy_url")
    environ = os.environ if env is None else env
    if target_url and _no_proxy_hit(target_url, environ):
        return ProxyInfo(url=None, source=SOURCE_ENV, var=NO_PROXY_VARS[0])
    from_env = _proxy_from_env(environ)
    if from_env is not None:
        return from_env
    reader = _system_proxies_default if system_proxies is None else system_proxies
    from_system = _proxy_from_system(reader() or {})
    if from_system is not None:
        return from_system
    return ProxyInfo(url=None, source=SOURCE_DIRECT, var="no_proxy_configured")


def resolve_proxy_for(url: str | None) -> ProxyInfo:
    """:func:`resolve_proxy` 的便捷封装（只关心"这个地址走什么"）。"""
    return resolve_proxy(target_url=url)


__all__ = [
    "CONNECT_MESSAGE",
    "DIRECT_HEADER",
    "DIRECT_OVERRIDE",
    "ENV_PROXY_VARS",
    "NET_PATH_CONNECT",
    "NET_PATH_DIRECT",
    "NET_PATH_LABELS",
    "NET_PATH_PROXY_REFUSED",
    "NET_PATH_PROXY_SOCKS",
    "NET_PATH_TIMEOUT",
    "NET_PATH_TLS",
    "NO_PROXY_VARS",
    "ProxyConfigurationError",
    "ProxyInfo",
    "SOURCE_CUSTOM",
    "SOURCE_DIRECT",
    "SOURCE_ENV",
    "SOURCE_LABELS",
    "SOURCE_LOOPBACK",
    "SOURCE_OVERRIDE",
    "SOURCE_REGISTRY",
    "SOURCE_SYSTEM",
    "SocksProxyUnsupported",
    "TIMEOUT_MESSAGE",
    "TLS_REASON_EXPIRED",
    "TLS_REASON_HOSTNAME",
    "TLS_REASON_OTHER",
    "TLS_REASON_SELF_SIGNED",
    "build_async_client",
    "build_client",
    "bump_generation",
    "classify_and_message",
    "classify_network_error",
    "direct_override_active",
    "force_direct",
    "generation",
    "is_loopback_host",
    "is_loopback_url",
    "is_socks_import_error",
    "last_tls_failure",
    "network_error_message",
    "parse_direct_header",
    "proxy_note",
    "proxy_refused_message",
    "remember_tls_failure",
    "reset_system_trust",
    "reset_tls_failure",
    "resolve_proxy",
    "resolve_proxy_for",
    "socks_unsupported_message",
    "system_trust_context",
    "tls_reason",
    "tls_reason_from_detail",
    "transport_kwargs",
]

# 拆分后的两个模块在文件末尾 import：此时本模块的公开名字已全部定义，延迟引用不会成环。
from .net_client import (  # noqa: E402
    build_async_client,
    build_client,
    reset_system_trust,
    system_trust_context,
    transport_kwargs,
)
from .net_tls import (  # noqa: E402
    TLS_REASON_EXPIRED,
    TLS_REASON_HOSTNAME,
    TLS_REASON_OTHER,
    TLS_REASON_SELF_SIGNED,
    classify_and_message,
    classify_network_error,
    is_socks_import_error,
    last_tls_failure,
    network_error_message,
    proxy_note,
    proxy_refused_message,
    remember_tls_failure,
    reset_tls_failure,
    socks_unsupported_message,
    tls_reason,
    tls_reason_from_detail,
)
