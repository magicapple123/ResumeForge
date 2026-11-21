# SPDX-License-Identifier: Apache-2.0
"""代理描述的类型层：来源标识、:class:`ProxyInfo` 与配置异常（T02）。

从 ``net_proxy`` 拆出（原文件 498 行，贴住 500 行预算；``backend/tests/test_file_size_budget.py``
零豁免）。拆出的理由是**职责缝**很干净：这里全是"怎么描述一条代理"，不含任何解析与
出网决策——判定顺序、环境变量、注册表、直连覆盖都留在 ``net_proxy``。

三条硬约束（违反即返工）：

- ``net_proxy`` 在**文件顶部** import 本模块并 re-export 全部公开名（它的 ``__all__``
  逐条列着），所以 ``net_proxy.ProxyInfo`` / ``net_proxy.SOURCE_*`` 这类既有调用点
  （12+ 处 ``from . import net_proxy`` 后按属性取用）零改动；
- 本模块**不得**反向 import ``net_proxy``——``net_proxy`` 顶层就 import 本模块，
  反向引用会在 import 期成环；
- 也**不要**在模块级 import ``net_tls``：那个模块顶层写着 ``from .net_proxy import
  ProxyInfo``，而本模块在 ``net_proxy`` 的 import 还没走完时就被求值，模块级引用会拿到
  半初始化的模块并 ImportError。唯一的消费者 :class:`SocksProxyUnsupported` 因此在
  ``__init__`` 里做函数内 import（调用期两个模块都已加载完）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

# ===== 来源标识 =====

SOURCE_ENV = "env"
SOURCE_REGISTRY = "registry"
SOURCE_SYSTEM = "system"
SOURCE_CUSTOM = "custom"
SOURCE_DIRECT = "direct"
SOURCE_LOOPBACK = "loopback"
SOURCE_OVERRIDE = "override"

#: 来源的中文名。``env`` 的完整文案是"环境变量 + 变量名"，见 :meth:`ProxyInfo.source_label`。
SOURCE_LABELS: dict[str, str] = {
    SOURCE_ENV: "环境变量",
    SOURCE_REGISTRY: "注册表",
    SOURCE_SYSTEM: "系统设置",
    SOURCE_CUSTOM: "设置里的自定义代理",
    SOURCE_DIRECT: "直连",
    SOURCE_LOOPBACK: "回环地址强制直连",
    SOURCE_OVERRIDE: "本次请求选择了直连",
}

#: 出网路径字面量里唯一被描述层用到的那个（:meth:`ProxyInfo.fingerprint` 的直连返回值）。
#: 其余 ``NET_PATH_*`` 与 ``net_tls`` 的错误分类绑定，留在 ``net_proxy``。
NET_PATH_DIRECT = "direct"

_SOCKS_SCHEME_PREFIX = "socks"


class ProxyConfigurationError(RuntimeError):
    """代理配置在**发起请求之前**就已注定失败（目前只有 socks 缺依赖这一种）。"""


class SocksProxyUnsupported(ProxyConfigurationError):
    """代理是 socks 协议。本项目不装 ``httpx[socks]``，所以只能明确报错。"""

    def __init__(self, proxy: ProxyInfo) -> None:
        self.proxy = proxy
        # 函数内 import（见模块头第三条）：net_tls 顶层 `from .net_proxy import
        # ProxyInfo`，模块级引用会在 import 期成环、拿到半初始化的模块。
        from .net_tls import socks_unsupported_message

        super().__init__(socks_unsupported_message(proxy))


@dataclass(frozen=True)
class ProxyInfo:
    """一条**可对外**的代理描述：``url=None`` 表示直连。"""

    url: str | None = None
    source: str = SOURCE_DIRECT
    var: str = ""

    @property
    def is_direct(self) -> bool:
        return not self.url

    @property
    def scheme(self) -> str:
        return _safe_split(self.url).scheme.lower() if self.url else ""

    @property
    def host_port(self) -> str:
        """``host:port``（IPv6 带方括号）；直连时为空串。**不含账号口令**。"""
        if not self.url:
            return ""
        parts = _safe_split(self.url)
        host = parts.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        try:
            port = parts.port
        except ValueError:
            port = None
        return f"{host}:{port}" if port is not None else host

    @property
    def has_auth(self) -> bool:
        if not self.url:
            return False
        parts = _safe_split(self.url)
        return bool(parts.username or parts.password)

    @property
    def is_socks(self) -> bool:
        return self.scheme.startswith(_SOCKS_SCHEME_PREFIX)

    def source_label(self) -> str:
        """来源的中文说明；环境变量带上具体变量名（``环境变量 HTTP_PROXY``）。"""
        base = SOURCE_LABELS.get(self.source, self.source)
        if self.source == SOURCE_ENV and self.var:
            return f"{base} {self.var}"
        return base

    def redacted(self) -> dict[str, Any]:
        """脱敏形态：只给来源 + ``host:port`` + 有没有凭据。诊断包与接口都用它。"""
        return {
            "source": self.source,
            "source_label": self.source_label(),
            "var": self.var,
            "scheme": self.scheme,
            "host_port": self.host_port,
            "has_auth": self.has_auth,
            "is_direct": self.is_direct,
        }

    def fingerprint(self) -> str:
        """连接池分键用：同一条出网路径 → 同一个键。**绝不含凭据**。"""
        if not self.url:
            return NET_PATH_DIRECT
        return f"{self.source}:{self.var}:{self.scheme}://{self.host_port}"

    def describe(self) -> str:
        """一句话中文描述（日志与诊断包用）。"""
        if not self.url:
            return f"直连（{self.source_label()}）"
        auth = "，需要认证" if self.has_auth else ""
        return f"{self.scheme}://{self.host_port}（来源：{self.source_label()}{auth}）"


def _safe_split(url: str):
    try:
        return urlsplit(url)
    except ValueError:  # 非法端口等：退化成空结构，绝不让"读描述"抛异常
        return urlsplit("")


__all__ = [
    "NET_PATH_DIRECT",
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
]
