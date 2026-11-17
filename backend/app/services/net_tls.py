# SPDX-License-Identifier: Apache-2.0
"""出网错误的分类与文案（T02 / T05）。

从 ``net_proxy`` 拆出（原文件 831 行，超 500 行预算）。这里只放"异常 → 人话"的部分：
socks 缺依赖的识别、证书失败的四种细分、代理在用时的措辞。

**为什么用函数内延迟引用 ``net_proxy``**：``net_proxy`` 在文件末尾反过来 re-export 本模块
的名字（保持 `net_proxy.classify_network_error` 这类既有调用点零改动）。模块级互相 import
会成环；把引用放进函数体后，import 期只依赖 stdlib。
"""

from __future__ import annotations

import ssl
import threading
from typing import Any

import httpx

from . import net_proxy as _np
from .net_proxy import ProxyInfo

# ===== 错误分类与文案 =====


def is_socks_import_error(exc: BaseException) -> bool:
    """是否是"socks 缺依赖"那个 ``ImportError``（httpx 会抛带 ``socksio`` 的消息）。"""
    return isinstance(exc, ImportError) and _np._SOCKS_IMPORT_MARKER in str(exc).lower()


def _closest_tls_exception(exc: BaseException) -> ssl.SSLError | None:
    """沿异常链找最内层的 ``ssl.SSLError``（httpx 会把它包在 ``ConnectError`` 里）。"""
    seen: set[int] = set()
    current: BaseException | None = exc
    found: ssl.SSLError | None = None
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ssl.SSLError):
            found = current
        current = current.__cause__ or current.__context__
    return found


def _is_tls_failure(exc: BaseException) -> bool:
    """是否是 TLS 证书校验失败。"""
    if _closest_tls_exception(exc) is not None:
        return True
    text = str(exc).lower()
    return "certificate verify failed" in text or "certificate_verify_failed" in text


#: TLS 失败的四种人话。**只在有把握时细分**：认不出就 ``other``，不猜。
TLS_REASON_SELF_SIGNED = "self_signed"
TLS_REASON_EXPIRED = "expired"
TLS_REASON_HOSTNAME = "hostname"
TLS_REASON_OTHER = "other"


def tls_reason(exc: BaseException) -> str:
    """把证书校验失败细分成四种（依据 ``SSLCertVerificationError.verify_message``）。

    判据来自 OpenSSL 的固定文本；拿不到 verify_message（例如异常被别的层重新包过、
    只剩一句 ``certificate verify failed``）时归 ``other``——**猜错的代价比不猜大**：
    用户会照着错误的动作白折腾一轮。
    """
    inner = _closest_tls_exception(exc)
    message = ""
    if isinstance(inner, ssl.SSLCertVerificationError):
        message = str(getattr(inner, "verify_message", "") or "")
    if not message:
        # 退化路径：真实握手时 `verify_message` 有值；手工构造或别的层重新包装过时，
        # 只有最内层的文本还留着 "self-signed" / "expired" 这些关键词。
        message = str(inner) if inner is not None else str(exc)
    lowered = message.lower()
    if "self-signed" in lowered or "self signed" in lowered:
        return TLS_REASON_SELF_SIGNED
    if "expired" in lowered:
        return TLS_REASON_EXPIRED
    if "hostname mismatch" in lowered or "doesn't match" in lowered or "not valid for" in lowered:
        return TLS_REASON_HOSTNAME
    return TLS_REASON_OTHER


_LAST_TLS_LOCK = threading.Lock()
_LAST_TLS: dict[str, Any] | None = None


def remember_tls_failure(exc: BaseException, url: str | None) -> None:
    """记下最近一次证书失败（诊断包用）。**只留 host 与 verify_message，不留路径**。"""
    global _LAST_TLS
    inner = _closest_tls_exception(exc)
    verify_message = ""
    if isinstance(inner, ssl.SSLCertVerificationError):
        verify_message = str(getattr(inner, "verify_message", "") or "")
    if not verify_message:
        verify_message = (str(inner) if inner is not None else str(exc)).splitlines()[0][:200]
    record = {
        "host": _np._host_of(url or "") or (url or "")[:120],
        "reason": tls_reason(exc),
        "verify_message": verify_message[:300],
    }
    with _LAST_TLS_LOCK:
        _LAST_TLS = record


def last_tls_failure() -> dict[str, Any] | None:
    """最近一次证书失败的脱敏记录（没有就 ``None``）。"""
    with _LAST_TLS_LOCK:
        return dict(_LAST_TLS) if _LAST_TLS is not None else None


def reset_tls_failure() -> None:
    """清空记录（测试与"导出诊断后重置"用）。"""
    global _LAST_TLS
    with _LAST_TLS_LOCK:
        _LAST_TLS = None


def classify_network_error(exc: BaseException, proxy: ProxyInfo | None = None) -> str:
    """把网络异常分成 ``LLMError.net_path`` 的五种取值。

    Args:
        exc: httpx 抛出的传输异常（或 :class:`SocksProxyUnsupported`）。
        proxy: 本次实际使用的代理；``None`` 等同于"未知，按直连判断"。

    Returns:
        ``proxy_refused`` / ``proxy_socks_unsupported`` / ``tls_untrusted`` /
        ``connect`` / ``timeout`` 之一。

    Raises:
        ImportError: **不是** socks 缺依赖的 ``ImportError`` 一律原样抛出——那是代码
            缺陷，兜住它只会把"某处 import 写错了"伪装成网络问题。
    """
    if isinstance(exc, _np.SocksProxyUnsupported):
        return _np.NET_PATH_PROXY_SOCKS
    if isinstance(exc, ImportError):
        if is_socks_import_error(exc):
            return _np.NET_PATH_PROXY_SOCKS
        raise exc
    if _is_tls_failure(exc):
        return _np.NET_PATH_TLS
    if isinstance(exc, TimeoutError):
        return _np.NET_PATH_TIMEOUT
    if isinstance(exc, httpx.TimeoutException):
        return _np.NET_PATH_TIMEOUT
    if proxy is not None and not proxy.is_direct:
        # 有代理参与时，"连不上"最常见的原因就是代理没开/端口错（比目标站不可达常见
        # 一个数量级）。文案会说清"经代理 X 失败"，用户能立刻分辨该改哪一头。
        return _np.NET_PATH_PROXY_REFUSED
    return _np.NET_PATH_CONNECT


def proxy_note(url: str | None = None) -> str:
    """给别处的错误文案补一句"当前经代理 …"；没在用代理时返回空串。

    规则只有一条：**代理在用就提代理，没在用就不提**。在抓取/OCR/ASR 这些域里
    各写一份"要不要提代理"的判断，迟早会出现"同一次断网，模型页说代理、识别页说网络"。
    """
    proxy = _np.resolve_proxy(target_url=url)
    if proxy.is_direct:
        return ""
    return f"（当前经代理 {proxy.host_port}、来源：{proxy.source_label()}）"


def proxy_refused_message(proxy: ProxyInfo) -> str:
    """代理连接失败的可操作文案（验收口径：``经代理 127.0.0.1:1 连接失败（来源：环境变量 HTTP_PROXY）``）。"""
    return (
        f"经代理 {proxy.host_port} 连接失败（来源：{proxy.source_label()}）。"
        "请确认代理软件正在运行、端口没写错；也可以在设置里改为直连后重试"
    )


def socks_unsupported_message(proxy: ProxyInfo) -> str:
    """socks 的明确报错（引导换 http 端口，而不是让用户去装依赖）。"""
    return (
        f"代理 {proxy.scheme}://{proxy.host_port}（来源：{proxy.source_label()}）"
        "用的是 socks 协议，当前版本不支持 socks 代理。"
        "请改用代理软件提供的 http 端口（例如 http://127.0.0.1:7890），"
        "或在「设置 → 外部连接」里改为直连"
    )


def tls_reason_from_detail(detail: str) -> str:
    """从错误文本再判一次 TLS 细分（``network_error_message`` 只拿得到字符串）。

    与 :func:`tls_reason` 共用同一组判据；这里是"退化版本"，认不出同样归 ``other``。
    """
    lowered = (detail or "").lower()
    if "self-signed" in lowered or "self signed" in lowered:
        return TLS_REASON_SELF_SIGNED
    if "expired" in lowered:
        return TLS_REASON_EXPIRED
    if "hostname mismatch" in lowered or "doesn't match" in lowered or "not valid for" in lowered:
        return TLS_REASON_HOSTNAME
    return TLS_REASON_OTHER


def network_error_message(
    kind: str, *, proxy: ProxyInfo | None = None, url: str | None = None, detail: str = ""
) -> str:
    """分类 → 可直接展示给用户的中文文案。"""
    if kind == _np.NET_PATH_PROXY_REFUSED and proxy is not None:
        return proxy_refused_message(proxy)
    if kind == _np.NET_PATH_PROXY_SOCKS and proxy is not None:
        return socks_unsupported_message(proxy)
    if kind == _np.NET_PATH_TLS:
        host = _np._host_of(url or "") or (proxy.host_port if proxy else "")
        reason = tls_reason_from_detail(detail)
        if reason == TLS_REASON_SELF_SIGNED:
            return (
                f"连接 {host} 时证书不被信任：对方用的是自签名证书。常见于杀毒软件或公司"
                "网关对 HTTPS 做扫描/解密——把简历通加入它们的白名单、关掉加密扫描，或在"
                "「设置 → 外部连接」里打开「信任系统证书库」"
            )
        if reason == TLS_REASON_EXPIRED:
            return (
                f"连接 {host} 时证书不被信任：对方的证书已过期。"
                "请先确认本机时间正确；若是公司内网服务，请联系管理员更新证书"
            )
        if reason == TLS_REASON_HOSTNAME:
            return (
                f"连接 {host} 时证书不被信任：证书上的域名与这个地址不一致。"
                "多为 Base URL 里写了 IP 或别名域名——改成证书上的域名后重试"
            )
        return (
            f"连接 {host} 时 TLS 证书校验失败：本机不信任对方的证书（常见于公司网络做了"
            "中间人解密）。请改用系统信任的证书，或让网络管理员放行该域名"
        )
    if kind == _np.NET_PATH_TIMEOUT:
        return _np.TIMEOUT_MESSAGE
    if proxy is not None and not proxy.is_direct:
        return (
            f"{_np.CONNECT_MESSAGE}（当前经代理 {proxy.host_port}、来源：{proxy.source_label()}；"
            "也可以点「用直连重试」）"
        )
    return _np.CONNECT_MESSAGE


def classify_and_message(
    exc: BaseException, *, proxy: ProxyInfo | None = None, url: str | None = None
) -> tuple[str, str, str]:
    """一次拿到 ``(net_path, message, log_detail)``；三个值同源，谁都不会说谎。"""
    kind = classify_network_error(exc, proxy)
    # 细分证书失败要看**最内层**文本：httpx 包出来的那句 ConnectError 只剩
    # "certificate verify failed"，"self-signed / expired" 都在 __cause__ 里。
    inner = _closest_tls_exception(exc) if kind == _np.NET_PATH_TLS else None
    detail_text = f"{exc} {inner}" if inner is not None else str(exc)
    message = network_error_message(kind, proxy=proxy, url=url, detail=detail_text)
    if kind == _np.NET_PATH_TLS:
        # 诊断包要能看到"上一次为什么证书没通过"，但只留 host + verify_message。
        remember_tls_failure(exc, url)
    if kind != _np.NET_PATH_DIRECT:
        from . import net_diagnostics

        net_diagnostics.record_failure(_np._host_of(url or ""), kind)
    # 日志细节**只留类别与异常类名**：上游原始文本（地址、证书主体、服务端回应片段）
    # 属于用户隐私边界，`test_llm_context_length_error` 明确要求它不出现在日志里；
    # 需要更细的证书原因时走 `remember_tls_failure` 的诊断段（只留 host + verify_message）。
    reason = tls_reason_from_detail(detail_text) if kind == _np.NET_PATH_TLS else ""
    detail = f"{kind}/{type(exc).__name__}" + (f"/{reason}" if reason else "")
    return kind, message, detail
