# SPDX-License-Identifier: Apache-2.0
"""思考参数能力表（**拼装入口**）：把国产与国外两张规则表按固定顺序拼起来并做匹配。

2026-11-09 第 11 条把表补到 22 个预设后，单文件会顶穿 500 行预算，于是按「数据 vs 判断」
与「国内 / 国外」各拆一层：

- ``thinking_vendors.py``：结构（VendorRule）、常量、强制思考型号清单、关闭片段生成；
- ``thinking_vendor_rules_cn.py`` / ``thinking_vendor_rules_global.py``：两张纯数据表；
- 本文件：拼接 + 主机/型号匹配（唯一入口 ``match_rule``）。
"""

from __future__ import annotations

from ...schemas.setting import LLMConfig
from .thinking_vendor_rules_cn import DOMESTIC_RULES
from .thinking_vendor_rules_global import GLOBAL_RULES
from .thinking_vendors import VendorRule, host_of

# 顺序 = 优先级（同一主机的多条规则靠顺序区分，如 DashScope 的 qwen 与托管型号）。
VENDOR_RULES: tuple[VendorRule, ...] = DOMESTIC_RULES + GLOBAL_RULES

# 品牌前缀主机：这些厂商有多个官方域名（api.minimax.io / api.minimaxi.com /
# api.minimax.chat、api.moonshot.cn / api.moonshot.ai），规则只写共同前缀。
_BRAND_PREFIX_HOSTS = frozenset({"api.minimax", "api.moonshot"})


def host_matches(host: str, rule_host: str) -> bool:
    """主机匹配：完整域名按边界匹配，品牌前缀主机放宽到前缀。"""
    if host == rule_host or host.endswith("." + rule_host):
        return True
    return rule_host in _BRAND_PREFIX_HOSTS and host.startswith(rule_host)


def match_rule(config: LLMConfig) -> VendorRule | None:
    """按能力表找这个端点/型号的规则；未收录返回 None。"""
    host = host_of(config.base_url)
    model = str(config.model or "").strip().casefold()
    for rule in VENDOR_RULES:
        # 完整域名按边界匹配，避免把 api.deepseek.com.example.org 当作官方服务。
        if rule.host and not host_matches(host, rule.host):
            continue
        if rule.model_pattern is not None and not rule.model_pattern.search(model):
            continue
        return rule
    return None


__all__ = ["VENDOR_RULES", "host_matches", "match_rule"]
