# SPDX-License-Identifier: Apache-2.0
"""自定义搜索来源的模板与**纯校验**（CR-09）。

放在 ``schemas`` 而不是 ``services/search`` 的原因：这些规则是"什么样的输入被接受"，
和 ``SearchConfig`` 的其余字段校验是同一层职责；运行时（发请求、解析响应）在
``services/search/custom.py``。两者共用的模板常量只有这一份。

## 安全边界（改之前先读）

- base_url **只允许 http/https**，不能带账号/密码/查询参数/片段；IP 字面量必须是公网
  地址（回环放行——本机网关是合法用法），其余一律拒绝。这是 SSRF 的第一道闸。
- 端点只能是**相对路径**：不允许 ``https://...``、不允许 ``//host``、不允许 ``..``。
  否则用户填的"路径"会直接改写请求目标主机。
- 字段映射语法是闭集：``a.b`` / ``a[0].b``。它只用于**读响应**，不参与拼 URL。
"""

from __future__ import annotations

import ipaddress
import re
from typing import Any
from urllib.parse import urlsplit

from ..vocabulary.net_address import non_public_address_reason

#: 协议模板。``moonshot`` 只差一个 base_url；``generic`` 还要用户填端点与字段。
CUSTOM_TEMPLATES: dict[str, dict[str, Any]] = {
    "moonshot": {
        "label": "Kimi（Moonshot）",
        "search_path": "/v1/tools/search",
        "fetch_path": "/v1/tools/fetch",
        "results_field": "search_result",
        "include_content": True,
        "needs_key": True,
    },
    "generic": {
        "label": "通用（自填端点与字段映射）",
        "search_path": "",
        "fetch_path": "",
        "results_field": "",
        "include_content": True,
        "needs_key": False,
    },
}
CUSTOM_TEMPLATE_IDS: tuple[str, ...] = tuple(CUSTOM_TEMPLATES)

_FIELD_PATH_RE = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(\[\d+\])?(\.[A-Za-z_][A-Za-z0-9_]*(\[\d+\])?)*$"
)


def _non_public_ip_reason(host: str) -> str | None:
    """IP 字面量的非公网原因；主机名返回 ``None``（域名解析是出网层的职责）。

    判定来自 ``vocabulary.net_address``——纯判定，不含 IO/ORM，契约层可以直接依赖；
    出网层经由 ``services.net_policy`` 再导出同一份实现（唯一实现不分裂）。
    """
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return None
    if address.is_loopback:
        # 本机网关 / 本地 SearXNG 一类：合法用法，放行。
        return None
    return non_public_address_reason(str(address))


def normalize_custom_base_url(value: str) -> str:
    """校验并归一化自定义搜索的根地址（空串 = 尚未配置）。"""
    cleaned = (value or "").strip().rstrip("/")
    if not cleaned:
        return ""
    try:
        parsed = urlsplit(cleaned)
        host = (parsed.hostname or "").casefold()
    except ValueError as exc:
        raise ValueError("自定义搜索地址格式无效") from exc
    if parsed.scheme.lower() not in {"http", "https"} or not host:
        raise ValueError("自定义搜索地址必须以 http:// 或 https:// 开头")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("自定义搜索地址不能包含账号、密码、查询参数或片段")
    if _non_public_ip_reason(host) is not None:
        raise ValueError("自定义搜索地址不能指向内网 / 保留地址")
    return cleaned


def validate_custom_path(value: str) -> str:
    """端点必须是相对路径：以单个 ``/`` 开头，且不含 scheme / 主机 / 上跳。"""
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    if not cleaned.startswith("/") or cleaned.startswith("//"):
        raise ValueError("端点必须是相对路径（以 / 开头，不能写 //host）")
    if "://" in cleaned:
        raise ValueError("端点只填路径，不要写 http(s):// 前缀")
    if ".." in cleaned or "?" in cleaned or "#" in cleaned:
        raise ValueError("端点不能包含 ..、查询参数或片段")
    if len(cleaned) > 200:
        raise ValueError("端点路径过长")
    return cleaned


def validate_custom_field(value: str) -> str:
    """响应字段映射：只支持点号与 ``[n]``。"""
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    if not _FIELD_PATH_RE.match(cleaned):
        raise ValueError("字段路径只支持 a.b / a[0].b 这类写法")
    return cleaned


__all__ = [
    "CUSTOM_TEMPLATES",
    "CUSTOM_TEMPLATE_IDS",
    "normalize_custom_base_url",
    "validate_custom_field",
    "validate_custom_path",
]
