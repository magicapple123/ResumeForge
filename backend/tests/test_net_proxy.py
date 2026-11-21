# SPDX-License-Identifier: Apache-2.0
"""出网路径与错误分类（T02）。

这一组用例钉的是**顺序**与**边界**，不是实现细节：

1. 代理来源的优先级（请求级覆盖 > 回环 > 设置 > 环境 > 系统）；
2. 回环强制直连——本地模型与 CDP 探测不能被代理带走；
3. socks 是"明确报错"而不是 500（``ImportError`` 只在命中 socksio 时兜住）；
4. 诊断/日志里永远不出现口令。
"""

from __future__ import annotations

import urllib.request

import httpx
import pytest
from app.services import net_client, net_proxy

# 导入时就绑定原函数：conftest 的 autouse fixture 会把**模块属性**
# ``net_proxy._system_proxies_default`` 换成 ``lambda: {}``（模拟"这台机器没有代理"），
# 而下面要验的正是那个函数本身。
from app.services.net_proxy import (
    ProxyInfo,
    SocksProxyUnsupported,
    _system_proxies_default,
)

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


# ===== 1b. 设过 NO_PROXY 的机器仍要能读到系统/注册表代理 =====
#
# 用户实测（2026-11-21）：机器 ProxyEnable=1 / ProxyServer=127.0.0.1:7897，但只要环境里
# 还有 NO_PROXY（配过 CLI 代理的人常见），后端就把这条明明开着的系统代理判成直连——
# LLM / 搜索 / 检查更新一起裸奔。


def test_no_proxy_does_not_hide_the_registry_proxy(monkeypatch):
    """``getproxies()`` 只回 ``{'no': ...}`` 时，必须补读注册表。

    CPython 在 Windows 上把它实现成 ``getproxies_environment() or getproxies_registry()``；
    ``NO_PROXY`` 会被解析成非空的 ``{'no': ...}``，``or`` 于是短路，注册表那半永远不被
    调用。这里直接钉 ``_system_proxies_default`` 本身（conftest 的 autouse fixture 把这个
    模块属性换成了 ``lambda: {}``，所以下面用的是**导入时绑下的原函数对象**）。
    """
    monkeypatch.setattr(urllib.request, "getproxies", lambda: {"no": "localhost,127.*"})
    monkeypatch.setattr(
        urllib.request,
        "getproxies_registry",
        lambda: {"http": "127.0.0.1:7897", "https": "127.0.0.1:7897"},
        raising=False,  # 非 Windows 没有这个函数，这里补一个
    )

    proxies = _system_proxies_default()

    assert proxies.get("https") == "127.0.0.1:7897"
    # `no` 键原样留着无妨：`_proxy_from_system` 只认 https/http/all/socks。
    assert proxies.get("http") == "127.0.0.1:7897"


def test_resolve_proxy_falls_back_to_registry_when_no_proxy_is_set(monkeypatch):
    monkeypatch.setattr(urllib.request, "getproxies", lambda: {"no": "localhost"})
    monkeypatch.setattr(
        urllib.request,
        "getproxies_registry",
        lambda: {"https": "127.0.0.1:7897"},
        raising=False,
    )

    proxy = net_proxy.resolve_proxy(
        target_url="https://api.github.com/",
        env=_env(NO_PROXY="localhost,127.*,192.168.*"),
        system_proxies=_system_proxies_default,
    )

    assert proxy.url == "http://127.0.0.1:7897", "注册表代理必须补上（含 scheme 补全）"
    assert not proxy.is_direct
    # 来源随平台：Windows 是 registry，其余平台是 system。
    assert proxy.source in (net_proxy.SOURCE_REGISTRY, net_proxy.SOURCE_SYSTEM)
    assert proxy.var != "no_proxy_configured", "不能退化成「找不到代理」"


def test_env_proxy_still_wins_over_the_registry_fallback(monkeypatch):
    """补读注册表只在"一个可用 scheme 键都没有"时发生，不能抢环境变量的优先级。"""
    monkeypatch.setattr(urllib.request, "getproxies", lambda: {"http": "10.0.0.9:3128"})
    monkeypatch.setattr(
        urllib.request,
        "getproxies_registry",
        lambda: {"https": "127.0.0.1:7897"},
        raising=False,
    )

    proxies = _system_proxies_default()
    proxy = net_proxy.resolve_proxy(
        target_url="https://api.github.com/",
        env=_env(HTTPS_PROXY="http://127.0.0.1:6007"),
        system_proxies=lambda: proxies,
    )

    assert proxies.get("http") == "10.0.0.9:3128"
    assert "127.0.0.1:7897" not in str(proxies), "已有可用 scheme 时不该再问注册表"
    assert proxy.var == "HTTPS_PROXY", "环境变量仍然优先于系统代理"


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


# ===== 5. 拆分后的 re-export 契约（2026-11-21）=====
#
# `net_proxy` 被拆过两次（net_tls / net_client / net_proxy_types），每次都是"搬运 + 在
# 末尾或顶部 re-export"，靠 `__all__` 维持"既有调用点零改动"。可是 **re-export-only 的
# 名字没有任何正常用例会碰到**：它们只出现在 import 行与 `__all__` 的字符串里，body 从
# 不求值。QA 复核时把 `SOURCE_LABELS` 从 import 行删掉，93 条 net/update 用例全绿，而
# `net_proxy.SOURCE_LABELS` 已经 AttributeError——`SOURCE_OVERRIDE` 恰好变红是因为 body
# 里还引用它（靠运气）。所以下面两条必须直接盯 `__all__` 本身：
#   1. 名单里的每个名字都取得到（一次报全，不只报第一个）；
#   2. 搬走的名字是**同一个对象**，不是复制出来的第二份实现——复制会让
#      `except net_proxy.SocksProxyUnsupported` 抓不到工厂抛的那一个，且不会有用例变红。

#: 2026-11-21 拆到 :mod:`app.services.net_proxy_types` 的名字。
_MOVED_TO_TYPES = (
    "ProxyInfo",
    "ProxyConfigurationError",
    "SocksProxyUnsupported",
    "SOURCE_ENV",
    "SOURCE_REGISTRY",
    "SOURCE_SYSTEM",
    "SOURCE_CUSTOM",
    "SOURCE_DIRECT",
    "SOURCE_LOOPBACK",
    "SOURCE_OVERRIDE",
    "SOURCE_LABELS",
    "NET_PATH_DIRECT",
)


def test_every_name_in_all_is_reachable():
    missing = [name for name in net_proxy.__all__ if not hasattr(net_proxy, name)]
    assert missing == [], f"net_proxy.__all__ 里有取不到的名字：{missing}"


@pytest.mark.parametrize("name", _MOVED_TO_TYPES)
def test_moved_names_are_the_same_objects_as_the_types_module(name):
    from app.services import net_proxy_types

    assert getattr(net_proxy, name) is getattr(net_proxy_types, name), (
        f"{name} 在 net_proxy 里不是 net_proxy_types 的同一个对象——"
        "拆文件时可能复制了一份实现，而不是 re-export"
    )

