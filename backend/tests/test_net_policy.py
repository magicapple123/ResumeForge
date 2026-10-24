# SPDX-License-Identifier: Apache-2.0
"""`services/net_policy.py`：非公网地址判定的唯一实现（A09 收敛）。

为什么单独立这个文件：这段判定被两处共用（网页正文抓取 `search/page_reader.py` 与更新
下载 `update_sources.py`），此前是两份手抄的 ``is_private or is_loopback or ...`` 链，
其中更新下载那份漏了 CGNAT 段。这里的用例直接钉住"共有行为"，两边各自的 URL 级用例继续
负责各自的边界（scheme / 端口 / 白名单 / 重定向）。

钉住的性质：
- IPv4 / IPv6 的回环、链路本地、私网、保留、组播、CGNAT 段都被拒绝，且**返回英文键**；
- 真实公网地址返回 ``None``（判定过严会让抓取与更新整体哑掉）；
- 非法字面量返回 ``invalid`` 而**不抛异常**（DNS 脏数据不该变成 500）；
- 判定只收紧不放宽：IPv4-mapped IPv6（``::ffff:93.184.216.34``）仍被拒绝，与收敛前一致。
"""

from __future__ import annotations

import pytest
from app.services.net_policy import (
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

# 真实公网单播（示例域名的历史 A 记录、公共 DNS、Cloudflare IPv6）：必须放行。
PUBLIC_ADDRESSES = ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]

NON_PUBLIC_CASES = [
    # (地址, 期望原因键)
    # --- IPv4 ---
    ("10.0.0.5", ADDRESS_PRIVATE),
    ("172.16.5.4", ADDRESS_PRIVATE),
    ("192.168.1.10", ADDRESS_PRIVATE),
    ("198.51.100.7", ADDRESS_PRIVATE),  # 文档段：ipaddress 算 private
    ("0.0.0.0", ADDRESS_PRIVATE),  # 未指定地址
    ("127.0.0.1", ADDRESS_LOOPBACK),
    ("127.0.0.5", ADDRESS_LOOPBACK),  # 整个 127.0.0.0/8 都是回环
    ("169.254.1.1", ADDRESS_LINK_LOCAL),
    ("169.254.169.254", ADDRESS_LINK_LOCAL),  # 云元数据地址
    ("240.0.0.1", ADDRESS_RESERVED),
    ("255.255.255.255", ADDRESS_RESERVED),
    ("224.0.0.1", ADDRESS_MULTICAST),
    ("100.64.0.0", ADDRESS_SHARED),  # CGNAT 下边界
    ("100.64.0.1", ADDRESS_SHARED),
    ("100.127.255.255", ADDRESS_SHARED),  # CGNAT 上边界
    # --- IPv6 ---
    ("::1", ADDRESS_LOOPBACK),
    ("fe80::1", ADDRESS_LINK_LOCAL),
    ("fc00::1", ADDRESS_PRIVATE),  # 唯一本地地址 ULA
    ("fd12:3456:789a::1", ADDRESS_PRIVATE),
    ("ff02::1", ADDRESS_MULTICAST),
    # IPv4-mapped：按字面 IPv6 判定（不解封装）。命中哪个键可能因 Python 版本而异
    # （reserved / private），但结论必须一致：**拒绝**。解封装是已记录的限制，不是这里的承诺。
    ("::ffff:127.0.0.1", ADDRESS_RESERVED),
]


@pytest.mark.parametrize(("address", "expected"), NON_PUBLIC_CASES)
def test_non_public_addresses_return_their_reason_key(address, expected):
    """每个非公网地址都返回**稳定的英文键**，而不是中文句子（文案由调用方翻译）。"""
    reason = non_public_address_reason(address)
    assert reason == expected
    assert reason in NON_PUBLIC_REASONS
    assert reason.isascii()  # 公共函数不产出文案，避免第二套措辞分叉


@pytest.mark.parametrize("address", PUBLIC_ADDRESSES)
def test_public_addresses_are_allowed(address):
    """真实公网地址必须放行：判定过严会让正文抓取与更新下载整体哑掉。"""
    assert non_public_address_reason(address) is None


@pytest.mark.parametrize("address", ["", "not-an-ip", "example.com", "10.0.0.999", "300.1.1.1"])
def test_invalid_literals_return_a_reason_instead_of_raising(address):
    """DNS 给了脏数据时返回原因键，绝不让调用方吃到异常（否则一次抓取变成 500）。"""
    assert non_public_address_reason(address) == ADDRESS_INVALID


def test_ipv4_mapped_public_address_is_still_rejected_as_before():
    """只收敛实现、不放松规则：``::ffff:93.184.216.34`` 收敛前被拒，收敛后仍然被拒。

    这条专门防"重构时顺手把 IPv4-mapped 当成公网"——那会是一次**放宽**，属 A09 红线。
    """
    assert non_public_address_reason("::ffff:93.184.216.34") is not None


def test_cgnat_boundaries_are_exact():
    """100.64.0.0/10 的边界：段内拒绝，紧邻的两侧（100.63.x / 100.128.x）放行。"""
    assert SHARED_IPV4_SPACE.num_addresses == 2**22
    assert non_public_address_reason("100.63.255.254") is None
    assert non_public_address_reason("100.128.0.1") is None
    assert non_public_address_reason("100.64.0.1") == ADDRESS_SHARED


def test_ipv6_never_matches_the_ipv4_shared_space():
    """IPv6 地址不会误命中 IPv4 网段（``in`` 对版本不等返回 False）。"""
    assert non_public_address_reason("2606:4700:4700::1111") is None


@pytest.mark.parametrize("address", ["::ffff:100.64.0.1", "::ffff:169.254.1.1"])
def test_ipv4_mapped_addresses_are_rejected_whatever_the_key(address):
    """IPv4-mapped 形式也必须被拒；具体命中哪个键不是契约，拒绝才是。

    当前实现按字面 IPv6 判定、不做 4-in-6 解封装（已记录的限制），所以这里只断言
    "有原因"，不把 ``private`` / ``reserved`` 的归属钉死到某个 Python 版本的行为上。
    """
    assert non_public_address_reason(address) is not None


def test_reason_keys_are_unique_and_complete():
    """键集合是公开契约：重复或漏项都会让调用方的翻译表悄悄错位。"""
    from app.services import net_policy

    keys = [value for name, value in vars(net_policy).items() if name.startswith("ADDRESS_")]
    assert len(keys) == len(set(keys))
    assert set(keys) == set(NON_PUBLIC_REASONS)
