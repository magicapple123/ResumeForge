# SPDX-License-Identifier: Apache-2.0
"""网络代理设置（``global_settings.json`` 顶层 ``network``）：全局一份，跨数据集共用。

为什么全局：代理描述的是"这台机器怎么出网"，与当前打开哪份数据集无关。放进数据集库
会变成"切一份数据就要重配一遍代理"，与 `web_search` / `system_sources` 踩过的坑同构。

存储形态（**不升** ``GLOBAL_SETTINGS_VERSION``：升版本会让主题与大模型配置一起读丢）::

    "network": {
      "proxy_mode": "system" | "direct" | "custom",
      "proxy_url": "http://127.0.0.1:7890",
      "proxy_username": "user",
      "proxy_password": "<DPAPI 密文>"
    }

三条设计约束：

1. **不在 import 期读环境变量/注册表**。本模块只在被调用时读 ``global_settings.json``，
   解析环境与系统代理的活全在 :mod:`app.services.net_proxy`——否则测试与"这台机器
   装了什么代理软件"耦合，CI 会随开发机的 Clash 开关变红。
2. **口令只存密文**：走 `credentials.semantics` 的 DPAPI 语义（与其它凭据同一套
   ``apply_stored_key`` / ``encrypt_key``），明文只在内存里拼成运行时 URL。
   与「外部连接」页的凭据清单**刻意分开登记**：那份清单是 A/B 两组的展示枚举，
   多一条会让页面多出一行没有写入口的口令（写入口在本模块的 PUT），也会连锁改到
   页面的既有断言。代理口令的写入口唯一：``PUT /api/settings/network``。
3. **``proxy_url`` 不含凭据**：用户填 ``http://user:pass@host:port`` 时由
   :func:`split_credentials` 拆成 url + username + 密文口令，回给前端时只给
   ``has_password``。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from . import global_settings
from .api_key_crypto import ApiKeyEncryptionError, decrypt_key
from .credentials.semantics import CLEAR_SENTINEL, apply_stored_key

logger = logging.getLogger(__name__)

# global_settings.json 里的顶层块名（与 `web_search` / `system_sources` 平级）。
NETWORK_BLOCK = "network"

PROXY_MODE_SYSTEM = "system"
PROXY_MODE_DIRECT = "direct"
PROXY_MODE_CUSTOM = "custom"
PROXY_MODES: tuple[str, ...] = (PROXY_MODE_SYSTEM, PROXY_MODE_DIRECT, PROXY_MODE_CUSTOM)

# 只支持 http / https 代理：socks 需要 ``httpx[socks]``（额外依赖），本项目**不装**
# （见 net_proxy 的模块说明）。这里把它挡在写入侧，让用户在设置页就看到原因，
# 而不是等到模型调用失败时才在错误文案里发现。
SUPPORTED_SCHEMES: tuple[str, ...] = ("http", "https")

# 地址长度上限：只有 host:port（+可选 path）才有意义，超长必然是粘贴错了。
MAX_PROXY_URL_LENGTH = 300

# 口令的"清除"哨兵与凭据层共用同一个字面量（``__clear__``），语义同
# `PUT /api/settings/llm`：留空 = 保留，哨兵 = 清除。


class ProxyUrlError(ValueError):
    """代理地址非法。``str(exc)`` 可直接给用户看（含"怎么改"），由 API 层翻成 400。"""


@dataclass(frozen=True)
class NetworkSettings:
    """一份生效的网络设置快照（``password`` 是**已解密**的明文，只在内存里）。"""

    mode: str = PROXY_MODE_SYSTEM
    proxy_url: str = ""
    username: str = ""
    password: str = ""
    # 信任操作系统证书库（T05）：默认**关**。杀软/企业网关的 HTTPS 扫描会替换证书，
    # certifi 里没有这些根 → 校验必失败。打开后改用 `truststore` 读系统库。
    trust_system_certs: bool = False

    @property
    def is_direct(self) -> bool:
        return self.mode == PROXY_MODE_DIRECT

    def runtime_url(self) -> str:
        """拼成可以直接交给 httpx 的代理 URL（含凭据）；没有地址时返回空串。"""
        if not self.proxy_url:
            return ""
        if not self.username:
            return self.proxy_url
        parts = urlsplit(self.proxy_url)
        userinfo = quote(self.username, safe="")
        if self.password:
            userinfo = f"{userinfo}:{quote(self.password, safe='')}"
        return urlunsplit((parts.scheme, f"{userinfo}@{parts.netloc}", parts.path, "", ""))

    def public(self) -> dict[str, Any]:
        """对外形态：**没有口令**，只有"配没配"。"""
        return {
            "proxy_mode": self.mode,
            "proxy_url": self.proxy_url,
            "proxy_username": self.username,
            "has_password": bool(self.password),
            "trust_system_certs": self.trust_system_certs,
        }


def _coerce_mode(raw: Any) -> str:
    mode = str(raw or "").strip()
    return mode if mode in PROXY_MODES else PROXY_MODE_SYSTEM


def split_credentials(raw: str) -> tuple[str, str, str]:
    """把用户粘贴的地址拆成 ``(不含凭据的 url, 用户名, 口令)``。

    兼容"只有 host:port"（补 ``http://``）。非法输入抛 :class:`ProxyUrlError`，
    消息里带上正确形态，避免用户看着一个裸 400 猜。
    """
    text = (raw or "").strip()
    if not text:
        raise ProxyUrlError("请填写代理地址，形如 http://127.0.0.1:7890")
    if len(text) > MAX_PROXY_URL_LENGTH:
        raise ProxyUrlError("代理地址过长，请只填协议、主机与端口，形如 http://127.0.0.1:7890")
    if "://" not in text:
        text = f"http://{text}"
    try:
        parts = urlsplit(text)
    except ValueError as exc:
        raise ProxyUrlError("代理地址格式不对，形如 http://127.0.0.1:7890") from exc
    scheme = (parts.scheme or "").lower()
    if scheme.startswith("socks"):
        raise ProxyUrlError(
            "不支持 socks 代理（本版本没有安装 socks 依赖）。请改用代理软件提供的 http "
            "端口，形如 http://127.0.0.1:7890"
        )
    if scheme not in SUPPORTED_SCHEMES:
        raise ProxyUrlError("代理协议只支持 http:// 或 https://，形如 http://127.0.0.1:7890")
    try:
        host = parts.hostname or ""
        port = parts.port
    except ValueError as exc:
        raise ProxyUrlError("代理端口不是合法数字，形如 http://127.0.0.1:7890") from exc
    if not host:
        raise ProxyUrlError("代理地址缺少主机名，形如 http://127.0.0.1:7890")
    username = parts.username or ""
    password = parts.password or ""
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc = f"{netloc}:{port}"
    clean = urlunsplit((scheme, netloc, parts.path, "", ""))
    return clean, username, password


def normalize_proxy_url(raw: str) -> str:
    """只要"规范化后的地址"（丢掉凭据），供校验与回显。"""
    return split_credentials(raw)[0]


def _block_of(state: dict[str, Any] | None) -> dict[str, Any] | None:
    block = (state or {}).get(NETWORK_BLOCK)
    return block if isinstance(block, dict) else None


def read() -> NetworkSettings:
    """读文件（**不进缓存**）。坏 JSON / 权限错误一律降级成默认值，不抛错。"""
    block = _block_of(global_settings.load_state())
    if block is None:
        return NetworkSettings()
    stored = str(block.get("proxy_password") or "")
    password = ""
    if stored:
        try:
            password = decrypt_key(stored)
        except (ApiKeyEncryptionError, ValueError):
            # 换机器/换了系统账户后 DPAPI 解不开：当作没有口令，让请求带着无凭据的
            # 代理地址去试——错误文案会指回"代理需要认证"，比整页读不出来强。
            logger.warning("代理口令解密失败（换机器或换了系统账户），本次按无口令处理")
            password = ""
    return NetworkSettings(
        mode=_coerce_mode(block.get("proxy_mode")),
        proxy_url=str(block.get("proxy_url") or "").strip(),
        username=str(block.get("proxy_username") or ""),
        password=password,
        trust_system_certs=bool(block.get("trust_system_certs")),
    )


# 进程内快照：网络设置被**每一次模型调用**读取，不能每次都解析一遍 JSON。
# 失效靠文件 mtime+size 的令牌，而不是"记得调 invalidate"——测试里 conftest 直接删
# 全局设置文件，只有令牌能自动发现这一种变化。
_cache: NetworkSettings | None = None
_cache_token: tuple[int, int] | None = None


def _file_token() -> tuple[int, int] | None:
    try:
        info = global_settings.path().stat()
    except OSError:
        return None
    return (info.st_mtime_ns, info.st_size)


def current() -> NetworkSettings:
    """当前生效设置（带 mtime 令牌的进程内缓存；文件没变就零 IO）。"""
    global _cache, _cache_token
    token = _file_token()
    if _cache is not None and token == _cache_token:
        return _cache
    snapshot = read()
    _cache = snapshot
    _cache_token = _file_token()
    return snapshot


def invalidate() -> None:
    """丢掉缓存（写设置后立刻调用，让下一次读走文件）。"""
    global _cache, _cache_token
    _cache = None
    _cache_token = None


def _stored_password(incoming: str, existing_stored: str) -> tuple[str, bool]:
    """按"留空=保留 / 哨兵=清除 / 其余=新口令"算出落盘密文。

    返回 ``(密文, 是否改动)``。``apply_stored_key`` 是凭据层统一的那套语义，
    这里只是把"空串"翻成它认识的"保留"。
    """
    if incoming == CLEAR_SENTINEL:
        return "", True
    if not incoming:
        return existing_stored, False
    return apply_stored_key(incoming, existing_stored=existing_stored), True


def save(
    *,
    mode: str,
    proxy_url: str = "",
    username: str = "",
    password: str = "",
    trust_system_certs: bool | None = None,
) -> NetworkSettings:
    """写回设置并返回新快照。

    校验规则：

    - ``mode`` 必须是三个枚举值之一（未知值按 ``system`` 处理，不静默改成 custom）；
    - ``custom`` 必须有合法地址（:func:`split_credentials` 校验并拒绝 socks）；
    - ``proxy_url`` 里的 userinfo 会被拆成 ``username`` + 加密口令，**地址本身不留凭据**。

    抛 :class:`ProxyUrlError`（值非法）或 :class:`ApiKeyEncryptionError`（口令加密失败）。
    """
    resolved_mode = _coerce_mode(mode)
    clean_url = ""
    url_user = ""
    url_password = ""
    if proxy_url.strip():
        clean_url, url_user, url_password = split_credentials(proxy_url)
    if resolved_mode == PROXY_MODE_CUSTOM and not clean_url:
        raise ProxyUrlError("选了「自定义代理」就必须填代理地址，形如 http://127.0.0.1:7890")

    existing = _block_of(global_settings.load_state()) or {}
    effective_user = username.strip() or url_user
    incoming_password = password or url_password
    stored, _changed = _stored_password(
        incoming_password, str(existing.get("proxy_password") or "")
    )

    trust = (
        bool(existing.get("trust_system_certs"))
        if trust_system_certs is None
        else bool(trust_system_certs)
    )
    block: dict[str, Any] = {
        "proxy_mode": resolved_mode,
        "proxy_url": clean_url,
        "proxy_username": effective_user,
        "proxy_password": stored,
        "trust_system_certs": trust,
    }

    def _mutate(state: dict[str, Any]) -> None:
        state[NETWORK_BLOCK] = block

    global_settings.mutate_state(_mutate)
    invalidate()
    return NetworkSettings(
        mode=resolved_mode,
        proxy_url=clean_url,
        username=effective_user,
        password=decrypt_key(stored) if stored else "",
        trust_system_certs=trust,
    )


__all__ = [
    "CLEAR_SENTINEL",
    "MAX_PROXY_URL_LENGTH",
    "NETWORK_BLOCK",
    "PROXY_MODES",
    "PROXY_MODE_CUSTOM",
    "PROXY_MODE_DIRECT",
    "PROXY_MODE_SYSTEM",
    "SUPPORTED_SCHEMES",
    "NetworkSettings",
    "ProxyUrlError",
    "current",
    "invalidate",
    "normalize_proxy_url",
    "read",
    "save",
    "split_credentials",
]
