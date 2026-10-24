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
"IPv6 地址里编码了 IPv4"的形态按字面 IPv6 判定，不做解封装。
"""

from __future__ import annotations

import ipaddress

# ===== 原因键（公开契约）=====
#: 字面量不是合法 IP（调用方通常在文案里带上 ``repr(address)``）。
ADDRESS_INVALID = "invalid"
ADDRESS_PRIVATE = "private"
ADDRESS_LOOPBACK = "loopback"
ADDRESS_LINK_LOCAL = "link-local"
ADDRESS_RESERVED = "reserved"
ADDRESS_MULTICAST = "multicast"
#: 运营商级 NAT 共享地址段（IPv4 100.64.0.0/10）。
ADDRESS_SHARED = "shared-address-space"

#: 所有可能的原因键（公网放行时返回 ``None``，不在其中）。
NON_PUBLIC_REASONS = frozenset(
    {
        ADDRESS_INVALID,
        ADDRESS_PRIVATE,
        ADDRESS_LOOPBACK,
        ADDRESS_LINK_LOCAL,
        ADDRESS_RESERVED,
        ADDRESS_MULTICAST,
        ADDRESS_SHARED,
    }
)

#: CGNAT 共享地址段。单独点名比换成 ``not is_global`` 更保守：只多拒这一段。
SHARED_IPV4_SPACE = ipaddress.ip_network("100.64.0.0/10")


def non_public_address_reason(address: str) -> str | None:
    """地址是公网则返回 ``None``，否则返回一条原因键（见模块级常量）。

    判定顺序按**属性精度**排列：``loopback`` → ``link-local`` → ``reserved`` →
    ``multicast`` → ``private`` → ``shared-address-space``。只影响"命中哪个键"，不影响
    "放不放行"（每个键在两个调用方都落到拒绝）。之所以不是 ``private`` 打头：Python
    3.12 起 ``is_private`` 把回环与链路本地也算进去，``private`` 打头会让 ``loopback`` /
    ``link-local`` / ``reserved`` 三个键永远命中不了——那等于给调用方一张假的契约表。

    **解析失败不抛异常**——返回 :data:`ADDRESS_INVALID`，由调用方决定文案，这样"DNS 给了
    脏数据"不会变成 500。
    """
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return ADDRESS_INVALID
    if parsed.is_loopback:
        return ADDRESS_LOOPBACK
    if parsed.is_link_local:
        return ADDRESS_LINK_LOCAL
    if parsed.is_reserved:
        return ADDRESS_RESERVED
    if parsed.is_multicast:
        return ADDRESS_MULTICAST
    if parsed.is_private:
        return ADDRESS_PRIVATE
    if isinstance(parsed, ipaddress.IPv4Address) and parsed in SHARED_IPV4_SPACE:
        return ADDRESS_SHARED
    return None


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
    "non_public_address_reason",
]
