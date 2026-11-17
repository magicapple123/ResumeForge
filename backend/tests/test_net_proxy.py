# SPDX-License-Identifier: Apache-2.0
"""出网路径与错误分类（T02）。

这一组用例钉的是**顺序**与**边界**，不是实现细节：

1. 代理来源的优先级（请求级覆盖 > 回环 > 设置 > 环境 > 系统）；
2. 回环强制直连——本地模型与 CDP 探测不能被代理带走；
3. socks 是"明确报错"而不是 500（``ImportError`` 只在命中 socksio 时兜住）；
4. 诊断/日志里永远不出现口令。
"""

from __future__ import annotations

import httpx
import pytest
from app.services import net_client, net_proxy
from app.services.net_proxy import ProxyInfo, SocksProxyUnsupported

# 测试全程没有真实网络：这里只解析"该走哪条路"，不建连接。


def _env(**values: str) -> dict[str, str]:
    return dict(values)


# ===== 1. 来源优先级 =====


def test_https_env_wins_over_http_and_all():
    env = _env(
        HTTPS_PROXY="http://127.0.0.1:6001",
        HTTP_PROXY="http://127.0.0.1:6002",
        ALL_PROXY="http://127.0.0.1:6003",
    )
    proxy = net_proxy.resolve_proxy(
        target_url="https://api.deepseek.com/v1/chat/completions", env=env, settings=None
    )
    assert proxy.host_port == "127.0.0.1:6001"
    assert proxy.source == net_proxy.SOURCE_ENV
    assert proxy.var == "HTTPS_PROXY"


def test_lowercase_env_is_accepted():
    proxy = net_proxy.resolve_proxy(
        target_url="https://example.com", env=_env(http_proxy="http://127.0.0.1:6004")
    )
    assert proxy.host_port == "127.0.0.1:6004"
    assert proxy.var == "http_proxy"


def test_no_proxy_hit_goes_direct():
    env = _env(HTTP_PROXY="http://127.0.0.1:6005", NO_PROXY="example.com,.internal.cn")
    direct = net_proxy.resolve_proxy(target_url="https://api.internal.cn/v1", env=env)
    assert direct.is_direct
    assert direct.source == net_proxy.SOURCE_ENV
    proxied = net_proxy.resolve_proxy(target_url="https://api.deepseek.com/v1", env=env)
    assert proxied.host_port == "127.0.0.1:6005"


def test_settings_direct_overrides_env(monkeypatch):
    """设置里选「直连」必须压过环境变量——否则那个开关对 httpx 毫无约束力。"""
    from app.services import net_settings

    monkeypatch.setattr(
        net_settings, "current", lambda: net_settings.NetworkSettings(mode="direct")
    )
    proxy = net_proxy.resolve_proxy(
        target_url="https://api.deepseek.com", env=_env(HTTP_PROXY="http://127.0.0.1:6006")
    )
    assert proxy.is_direct
    assert proxy.var == "network.proxy_mode"


def test_settings_custom_without_url_is_direct_but_labelled(monkeypatch):
    from app.services import net_settings

    monkeypatch.setattr(
        net_settings,
        "current",
        lambda: net_settings.NetworkSettings(mode="custom", proxy_url=""),
    )
    proxy = net_proxy.resolve_proxy(target_url="https://api.deepseek.com", env=_env())
    assert proxy.is_direct
    # 来源说清楚"是这里没填"，而不是让用户以为代理生效了。
    assert proxy.var == "network.proxy_url"


# ===== 2. 回环强制直连 =====


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:11434/api/tags",
        "http://127.8.9.10:8000/",
        "http://[::1]:11434/",
        "http://localhost:11434/v1",
        "http://ollama.localhost:11434/v1",
    ],
)
def test_loopback_targets_ignore_proxy(url):
    proxy = net_proxy.resolve_proxy(target_url=url, env=_env(ALL_PROXY="http://127.0.0.1:7890"))
    assert proxy.is_direct
    assert proxy.source == net_proxy.SOURCE_LOOPBACK


def test_loopback_lookalike_is_not_loopback():
    """``127.0.0.1.evil.com`` 不是回环——按字符串前缀判会放走 SSRF 与代理绕过。"""
    proxy = net_proxy.resolve_proxy(
        target_url="http://127.0.0.1.evil.com/", env=_env(HTTP_PROXY="http://127.0.0.1:7890")
    )
    assert not proxy.is_direct


def test_request_override_beats_loopback_and_env():
    with net_proxy.force_direct(True):
        proxy = net_proxy.resolve_proxy(
            target_url="https://api.deepseek.com", env=_env(HTTP_PROXY="http://127.0.0.1:7890")
        )
    assert proxy.is_direct
    assert proxy.source == net_proxy.SOURCE_OVERRIDE


def test_direct_header_only_accepts_truthy_values():
    # 契约写死在实现注释里：只有 1 / true 算数。多认几个词会让"某个中间层顺手传了
    # 一个 yes"也能悄悄改掉出网路径。
    for value in ("1", "true", "TRUE", " true "):
        assert net_proxy.parse_direct_header(value) is True
    for value in (None, "", "0", "false", "no", "yes", "on"):
        assert net_proxy.parse_direct_header(value) is False


# ===== 3. socks：明确报错，不是 500 =====


def test_socks_proxy_is_refused_before_request():
    proxy = ProxyInfo(url="socks5://127.0.0.1:1080", source=net_proxy.SOURCE_ENV, var="ALL_PROXY")
    with pytest.raises(SocksProxyUnsupported) as excinfo:
        net_proxy.transport_kwargs(proxy)
    message = str(excinfo.value)
    assert "socks" in message
    # 引导用户换 http 端口，而不是让他去装依赖。
    assert "http://" in message
    assert net_proxy.classify_network_error(excinfo.value, proxy) == net_proxy.NET_PATH_PROXY_SOCKS


def test_socks_import_error_is_classified_as_socks():
    exc = ImportError("Using SOCKS proxy, but the 'socksio' package is not installed.")
    assert net_proxy.is_socks_import_error(exc) is True
    assert net_proxy.classify_network_error(exc) == net_proxy.NET_PATH_PROXY_SOCKS


def test_other_import_errors_are_not_swallowed():
    """别的 ImportError 是代码缺陷；兜住它会把"某处 import 写错"伪装成网络问题。"""
    exc = ImportError("No module named 'pypinyin'")
    with pytest.raises(ImportError):
        net_proxy.classify_network_error(exc)


# ===== 4. 分类与文案 =====


def test_connect_error_with_proxy_points_at_the_proxy():
    proxy = ProxyInfo(url="http://127.0.0.1:1", source=net_proxy.SOURCE_ENV, var="HTTP_PROXY")
    kind, message, detail = net_proxy.classify_and_message(
        httpx.ConnectError("All connection attempts failed"),
        proxy=proxy,
        url="https://api.deepseek.com",
    )
    assert kind == net_proxy.NET_PATH_PROXY_REFUSED
    assert "经代理 127.0.0.1:1 连接失败" in message
    assert "来源：环境变量 HTTP_PROXY" in message
    assert detail.startswith("proxy_refused/")


def test_connect_error_without_proxy_keeps_the_old_sentence():
    kind, message, _ = net_proxy.classify_and_message(
        httpx.ConnectError("All connection attempts failed"), proxy=ProxyInfo()
    )
    assert kind == net_proxy.NET_PATH_CONNECT
    assert message == net_proxy.CONNECT_MESSAGE


def test_timeout_keeps_the_old_sentence():
    kind, message, _ = net_proxy.classify_and_message(
        httpx.ReadTimeout("timed out"),
        proxy=ProxyInfo(url="http://127.0.0.1:7890", source=net_proxy.SOURCE_ENV, var="HTTP_PROXY"),
    )
    assert kind == net_proxy.NET_PATH_TIMEOUT
    assert message == net_proxy.TIMEOUT_MESSAGE


# ===== 5. 脱敏 =====


def test_redacted_never_contains_credentials():
    proxy = ProxyInfo(
        url="http://alice:s3cret@127.0.0.1:7890", source=net_proxy.SOURCE_ENV, var="HTTP_PROXY"
    )
    payload = proxy.redacted()
    assert payload["host_port"] == "127.0.0.1:7890"
    assert payload["has_auth"] is True
    assert "s3cret" not in repr(payload)
    assert "alice" not in repr(payload)
    # 指纹进连接池键，同样不许带凭据。
    assert "s3cret" not in proxy.fingerprint()
    assert "alice" not in proxy.fingerprint()


# ===== 6. 客户端工厂 =====


def test_build_client_disables_trust_env_and_passes_proxy(monkeypatch):
    captured: dict[str, object] = {}

    def fake_client(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(net_client.httpx, "Client", fake_client)
    net_proxy.build_client(
        url="https://api.deepseek.com",
        proxy=ProxyInfo(url="http://127.0.0.1:7890", source=net_proxy.SOURCE_ENV, var="HTTP_PROXY"),
    )
    assert captured["trust_env"] is False
    assert captured["proxy"] == "http://127.0.0.1:7890"


def test_build_client_with_injected_transport_ignores_machine_proxy(monkeypatch):
    captured: dict[str, object] = {}

    def fake_client(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(net_client.httpx, "Client", fake_client)
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    net_proxy.build_client(url="https://api.deepseek.com", transport=transport)
    # 注入了传输层就不再设代理：测试要确定性，不看这台机器装了什么。
    assert "proxy" not in captured
    assert "trust_env" not in captured


# ===== 7. 证书失败细分（T05）=====


def _tls_connect_error(text: str) -> httpx.ConnectError:
    """造一个"httpx 包着 SSLCertVerificationError"的异常（与真实调用栈同形）。"""
    import ssl

    inner = ssl.SSLCertVerificationError(1, text)
    outer = httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed")
    outer.__cause__ = inner
    return outer


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("certificate verify failed: self-signed certificate", net_proxy.TLS_REASON_SELF_SIGNED),
        ("certificate verify failed: certificate has expired", net_proxy.TLS_REASON_EXPIRED),
        ("certificate verify failed: Hostname mismatch", net_proxy.TLS_REASON_HOSTNAME),
        (
            "certificate verify failed: unable to get local issuer certificate",
            net_proxy.TLS_REASON_OTHER,
        ),
    ],
)
def test_tls_reason_is_split_into_four(text, expected):
    assert net_proxy.tls_reason(_tls_connect_error(text)) == expected


def test_tls_message_names_the_antivirus_path_for_self_signed():
    exc = _tls_connect_error("certificate verify failed: self-signed certificate")
    kind, message, _ = net_proxy.classify_and_message(
        exc, proxy=ProxyInfo(), url="https://api.example.com/v1"
    )
    assert kind == net_proxy.NET_PATH_TLS
    assert "证书不被信任" in message
    assert "杀毒软件" in message
    assert "信任系统证书库" in message


def test_tls_message_says_expired_without_guessing():
    exc = _tls_connect_error("certificate verify failed: certificate has expired")
    _, message, _ = net_proxy.classify_and_message(
        exc, proxy=ProxyInfo(), url="https://api.example.com/v1"
    )
    assert "已过期" in message
    assert "本机时间" in message


def test_tls_failure_is_remembered_for_diagnostics_without_paths():
    net_proxy.reset_tls_failure()
    exc = _tls_connect_error("certificate verify failed: self-signed certificate")
    net_proxy.classify_and_message(exc, proxy=ProxyInfo(), url="https://api.example.com/v1")
    record = net_proxy.last_tls_failure()
    assert record is not None
    assert record["host"] == "api.example.com"
    assert record["reason"] == net_proxy.TLS_REASON_SELF_SIGNED
    assert "verify_message" in record
    # 诊断包只留 host 与原因：路径里的用户名会跟着包发出去。
    assert "\\" not in record["host"] and "/" not in record["host"]
