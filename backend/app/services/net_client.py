# SPDX-License-Identifier: Apache-2.0
"""httpx 客户端工厂与系统证书库（T02 / T05）。

从 ``net_proxy`` 拆出（原文件 831 行，超 500 行预算）。这里是**唯一**允许直接构造
``httpx.Client`` / ``httpx.AsyncClient`` 的地方：``trust_env=False`` 与代理只由本模块决定，
否则"设置里改成直连"对 httpx 没有约束力。

同样用函数内延迟引用 ``net_proxy``（它在文件末尾 re-export 本模块）。
"""

from __future__ import annotations

import logging
import ssl
import threading
from typing import Any

import httpx

from . import net_proxy as _np
from . import net_settings

logger = logging.getLogger(__name__)

# ===== 客户端工厂 =====

_trust_lock = threading.Lock()
_trust_context: ssl.SSLContext | None = None
_trust_unavailable = False


def system_trust_context() -> ssl.SSLContext | None:
    """操作系统证书库的 SSL 上下文；不可用时 ``None``（退回 certifi）。

    只建一次并复用：``truststore`` 每次构造都会读一遍系统库，逐请求建会让"改完立即
    生效"变成"每句话多几十毫秒"。开关翻转由调用方（连接池 generation）负责失效。
    """
    global _trust_context, _trust_unavailable
    with _trust_lock:
        if _trust_context is not None:
            return _trust_context
        if _trust_unavailable:
            return None
        try:
            import truststore

            _trust_context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            return _trust_context
        except Exception:  # noqa: BLE001 - 缺依赖/系统库读不出都只是"用不了"，不是致命错误
            logger.warning("无法使用系统证书库，本次按 certifi 校验证书", exc_info=True)
            _trust_unavailable = True
            return None


def reset_system_trust() -> None:
    """丢掉缓存的系统证书上下文（测试与"切换开关后立即生效"用）。"""
    global _trust_context, _trust_unavailable
    with _trust_lock:
        _trust_context = None
        _trust_unavailable = False


def transport_kwargs(
    proxy: _np.ProxyInfo, *, trust_system_certs: bool | None = None
) -> dict[str, Any]:
    """把解析结果翻成 httpx 构造参数。

    ``trust_env=False`` 是**关键**：httpx 默认自己再读一遍环境变量，于是"设置里改成直连"
    对 httpx 完全没有约束力（它照样走 ``HTTP_PROXY``）。一律关掉，代理只由本模块决定。

    ``trust_system_certs``（T05）为真时把 ``verify`` 换成系统证书库的上下文：默认**关**，
    因为打开它等于承认"这台机器上任何被系统信任的中间人证书都可信"。
    """
    kwargs: dict[str, Any] = {"trust_env": False}
    if not proxy.is_direct:
        if proxy.is_socks:
            raise _np.SocksProxyUnsupported(proxy)
        kwargs["proxy"] = proxy.url
    trust = (
        net_settings.current().trust_system_certs
        if trust_system_certs is None
        else bool(trust_system_certs)
    )
    if trust:
        context = system_trust_context()
        if context is not None:
            kwargs["verify"] = context
    return kwargs


def _injected_transport_kwargs(
    transport: httpx.AsyncBaseTransport | httpx.BaseTransport,
    *,
    follow_redirects: bool,
    timeout: httpx.Timeout | float | None,
    headers: dict[str, str] | None,
) -> dict[str, Any]:
    """注入传输层时的构造参数（同步/异步共用一个实现，避免两边再次漂移）。

    **不设代理**：测试要的是确定性，而不是"这台机器有没有代理"。但 ``timeout`` 与
    ``headers`` 仍然透传——不然调用方想"走工厂 + 自己定超时"就只能回到直接构造
    （``update_sources.download_client`` 曾经就是这么漏出去的）。

    ``timeout is None`` 时**不传键**：httpx 的 ``timeout=None`` 是"永不超时"，与"用默认
    值"完全是两件事——``client_pool`` 这类不传超时的调用方会被静默改成无限等待。
    """
    injected: dict[str, Any] = {
        "transport": transport,
        "follow_redirects": follow_redirects,
    }
    if timeout is not None:
        injected["timeout"] = timeout
    if headers is not None:
        injected["headers"] = headers
    return injected


def build_async_client(
    *,
    url: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    follow_redirects: bool = False,
    timeout: httpx.Timeout | float | None = None,
    proxy: _np.ProxyInfo | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.AsyncClient:
    """新建一个异步客户端（**唯一**入口，别处不要再直接 ``httpx.AsyncClient``）。

    Args:
        url: 本次要访问的地址；回环地址会被强制直连（见 :func:`_np.resolve_proxy`）。
        transport: 测试注入的传输层。**注入时不再设代理**——测试要的是确定性，
            而不是"这台机器有没有代理"；``timeout`` / ``headers`` 仍然透传。
        proxy: 显式指定解析结果（跳过 :func:`_np.resolve_proxy`）。
    """
    resolved = proxy if proxy is not None else _np.resolve_proxy(target_url=url)
    if transport is not None:
        return httpx.AsyncClient(
            **_injected_transport_kwargs(
                transport, follow_redirects=follow_redirects, timeout=timeout, headers=headers
            ),
        )
    kwargs: dict[str, Any] = {"follow_redirects": follow_redirects, **transport_kwargs(resolved)}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if headers is not None:
        kwargs["headers"] = headers
    return httpx.AsyncClient(**kwargs)


def build_client(
    *,
    url: str | None = None,
    transport: httpx.BaseTransport | None = None,
    follow_redirects: bool = False,
    timeout: httpx.Timeout | float | None = None,
    proxy: _np.ProxyInfo | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Client:
    """同步版客户端工厂（字号/OCR/浏览器探测等同步链路用）。

    与异步版同一口径：注入 transport 时不设代理、但仍透传 ``timeout`` / ``headers``
    （2026-11-21 之前这里连 ``timeout`` 一起丢了，与异步版不对称）。
    """
    resolved = proxy if proxy is not None else _np.resolve_proxy(target_url=url)
    if transport is not None:
        return httpx.Client(
            **_injected_transport_kwargs(
                transport, follow_redirects=follow_redirects, timeout=timeout, headers=headers
            ),
        )
    kwargs: dict[str, Any] = {"follow_redirects": follow_redirects, **transport_kwargs(resolved)}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if headers is not None:
        kwargs["headers"] = headers
    return httpx.Client(**kwargs)
