# SPDX-License-Identifier: Apache-2.0
"""非公网地址判定的**唯一实现**（SSRF 的最后一个判定环节）。

## 为什么单独成模块

"这个 IP 能不能连"在两处被判：网页正文抓取（`services/search/page_reader.py`）和更新
下载（`services/update_sources.py`）。原先两处各写一套 ``is_private or is_loopback or
...`` 判定链，其中的一处（更新下载）漏了运营商级 NAT 共享段——同一个性质两份实现，
早晚会分叉。这里收成一份，两边都调用它；再改判定只改这一处。

## 为什么返回英文键而不是中文句子

两处对文案的消费方式不同：抓取模块把原因写进**日志**（面向排障，越具体越好），更新
模块把原因拼进**用户可见**的失败提示。若本模块直接产出中文句子，两边就会为了"措辞
不同"再分叉一次。因此这里只给稳定英文键（`private` / `loopback` / ...），文案由调用方
各自负责。键是公开契约：改键名必须同步改调用方的翻译表与 `tests/test_net_policy.py`。

## 判定范围

IPv4/IPv6 一律按 `ipaddress` 的标准属性判定，并额外点名 ``100.64.0.0/10``：该段是运营商
级 NAT（CGNAT）共享地址空间，`ipaddress` 既不认为它 ``is_private`` 也不认为它
``is_reserved``，而它根本不可能是公网站点——运营商与部分云厂商的内网服务恰恰在这段里。

已知边界（详见 `page_reader` 模块 docstring）：本模块只看**给定的地址字面量**，不负责
"DNS 校验结果与真实建连地址是否同一个"（TOCTOU / DNS rebinding）；6to4、NAT64 这类
"IPv6 地址里编码了 IPv4"的形态按字面 IPv6 判定，不做解封装；**IPv4-mapped（::ffff:0:0/96）
例外——整类拒绝**，因为标准库对它的判定随 Python 小版本漂移（3.12.2 视为 reserved，
3.12.10 却把 ::ffff:93.184.216.34 当公网放行），规则的确定性优先于"少拒一个映射形式"。
"""

from __future__ import annotations

import ipaddress

# 纯判定已下沉到 ``vocabulary.net_address``（契约层也要用它，见该模块 docstring）；
# 这里只做再导出 + 出网侧的 ``endpoint_class``，服务侧调用点与测试的导入路径不变。
from ..vocabulary.net_address import (
    ADDRESS_INVALID,
    ADDRESS_LINK_LOCAL,
    ADDRESS_LOOPBACK,
    ADDRESS_MULTICAST,
    ADDRESS_PRIVATE,
    ADDRESS_RESERVED,
    ADDRESS_SHARED,
    NON_PUBLIC_REASONS,
    SHARED_IPV4_SPACE,
    non_public_address_reason,
)


def endpoint_class(host: str) -> str | None:
    """用户填写的 endpoint 主机属于哪一类地址（公网/普通域名返回 None）。

    **主机名与 IP 字面量走同一个入口**：localhost 与 *.localhost 归为 loopback
    （与 payload.is_loopback_host 同一口径），其余主机名不在本层做 DNS 解析（DNS 与
    建连地址的绑定是出网策略层的职责，见模块 docstring 的已知边界）；IP 字面量复用
    non_public_address_reason，所以私网/回环/链路本地/CGNAT 等键与网页抓取、更新下载
    完全一致，不再出现"同一件事两种判定"。

    返回原因键而不是布尔值：调用方要区分"回环（本机 Ollama）"与"私网（内网服务）"
    写日志/文案，但放不放行只由调用方的显式开关决定。
    """
    normalized = str(host or "").strip().rstrip(".").casefold()
    if not normalized:
        return ADDRESS_INVALID
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return ADDRESS_LOOPBACK
    try:
        ipaddress.ip_address(normalized)
    except ValueError:
        return None  # 普通域名：本层不解析，也不凭后缀猜内网
    return non_public_address_reason(normalized)


__all__ = [
    "ADDRESS_INVALID",
    "ADDRESS_LINK_LOCAL",
    "ADDRESS_LOOPBACK",
    "ADDRESS_MULTICAST",
    "ADDRESS_PRIVATE",
    "ADDRESS_RESERVED",
    "ADDRESS_SHARED",
    "NON_PUBLIC_REASONS",
    "SHARED_IPV4_SPACE",
    "endpoint_class",
    "non_public_address_reason",
]
