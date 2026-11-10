# SPDX-License-Identifier: Apache-2.0
"""站点侧筛选条件的编码校验与 URL 参数收口（问题清单 `15.3-B/C）。

从 `boss_filters_catalog` 拆出：能力表带来的多选/联动规则让"把用户选的编码折成查询参数"
明显变长，而 catalog 已贴近 500 行预算。本模块是纯函数，不认识浏览器与 HTTP。

三条纪律（每条都对应一种**静默失效**）：

- 选的是「不限」（编码 `0`）→ 不产生这个参数（「不限 + 本科」等于「本科」）；
- 编码**不在**本次读到的清单里 → 只丢那一个码并写进 `unapplied`，绝不发出去；
- `visible_when` 不满足（例如兼职模式下仍存着历史 `salary`）→ **不发参数**、
  不计入 `applied`，并如实写进 `unapplied`（旧配置不会带着必然被站点忽略的值出门）。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .base import SOURCE_UNAVAILABLE

logger = logging.getLogger(__name__)

#: 「不限」的编码。**它不是一个筛选**：选中它等于不加这个查询参数。
UNLIMITED_CODE = "0"

#: 单个多选分组一次最多带这么多个编码（schema 已挡在入口，这里是防御性的第二道）。
MAX_CODES_PER_GROUP = 20


@dataclass
class ResolvedFilters:
    """一次采集要带上的查询参数，以及**没能执行**的那几条（如实上报，不静默丢）。"""

    params: dict[str, str] = field(default_factory=dict)
    applied: list[str] = field(default_factory=list)
    unapplied: list[str] = field(default_factory=list)
    #: 用户是否**在站点筛选里显式选过**求职类型（哪怕选的是「不限」）。
    #:
    #: `15.4-1 的坑：`build_search_url` 有一条旧映射（岗位类型 实习/社招 → jobType）。
    #: 用户显式选了「不限」= 不想按类型筛，此时必须压住旧映射，否则会静默地只采到某一类
    #: 岗位。真值来源只能是"用户动过这一组"，而不是"参数里有没有 jobType"。
    job_type_selected: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "params": dict(self.params),
            "applied": list(self.applied),
            "unapplied": list(self.unapplied),
        }


def _clean_code(value: Any) -> str:
    """把编码折成字符串；`0` 必须原样留下（`str(0 or "")` 会把它吃掉）。"""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _raw_codes(raw: Any) -> list[str]:
    """把入参折成"原始编码表"（去空、去重，**保留「不限」**）。

    容忍旧的单字符串形态：历史快照里存的是 `"203"`，必须照样读得出来。
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        values: Sequence[Any] = [raw]
    elif isinstance(raw, Sequence) and not isinstance(raw, (bytes, bytearray)):
        values = list(raw)
    else:
        values = [raw]
    codes: list[str] = []
    for item in values:
        code = _clean_code(item)
        if code and code not in codes:
            codes.append(code)
    return codes


def _codes_of(raw: Any) -> list[str]:
    """真正要发给站点的编码：去掉「不限」，其余顺序保留。"""
    return [code for code in _raw_codes(raw) if code != UNLIMITED_CODE]


def _controller_code(selected: Mapping[str, Any], key: str) -> str:
    """联动判断用：控制组的第一个原始编码（保留「不限」；没选时为空串）。"""
    codes = _raw_codes(selected.get(key))
    return codes[0] if codes else ""


def _controller_label(selected: Mapping[str, Any], key: str, by_key: Mapping[str, Any]) -> str:
    """联动原因里显示"当前求职类型"的人话值；编码对不上清单时回退原始值。"""
    code = _controller_code(selected, key)
    if not code:
        return "未选择"
    group = by_key.get(key)
    option = group.option(code) if group is not None else None
    return option.label if option is not None else code


def _is_visible(group: Any, selected: Mapping[str, Any]) -> bool:
    """`visible_when` 判定。

    规则形如 `("jobType", ("", "0", "1901", "1902"))`：控制组的当前值必须落在白名单里。
    「薪资待遇」的白名单包含空串/「不限」，因为**没选求职类型时它仍然可用**（站点默认不限
    类型，薪资会照常生效）；「结算方式 / 兼职时间」只认 `1903`（兼职），否则隐藏。
    """
    rule = getattr(group, "visible_when", None)
    if not rule:
        return True
    controller_key, allowed = rule
    return _controller_code(selected, controller_key) in allowed


def _hidden_reason(group: Any, selected: Mapping[str, Any], by_key: Mapping[str, Any]) -> str:
    rule = getattr(group, "visible_when", None)
    if not rule:
        return "当前条件下不适用"
    controller_key = rule[0]
    controller = by_key.get(controller_key)
    controller_label = controller.label if controller is not None else controller_key
    value_label = _controller_label(selected, controller_key, by_key)
    return f"{controller_label}为「{value_label}」时不适用"


def resolve_codes(
    selected: Mapping[str, Any] | None,
    catalogue: Sequence[Any],
) -> ResolvedFilters:
    """把用户在界面上选的 `{分组 key: 编码/编码表}` 折成查询参数。

    校验全在适配器层完成（编码必须来自**当次**读到的站点清单）：站点改版后旧编码照样
    "合法"，发出去会静默筛错，那比不筛更糟。
    """
    result = ResolvedFilters()
    if not selected:
        return result
    by_key = {group.key: group for group in catalogue}
    # 用户显式动过「求职类型」就压住旧映射——包括选了「不限」的情况（`15.4-1）。
    result.job_type_selected = "jobType" in selected
    for key in sorted(selected):
        group = by_key.get(key)
        if group is None:
            # 这一项是**旧配置留下的**（站点已经不再提供这个分组），同样如实上报。
            result.unapplied.append(key)
            continue
        if group.source == SOURCE_UNAVAILABLE:
            result.unapplied.append(group.label)
            continue
        if not _is_visible(group, selected):
            if _codes_of(selected.get(key)):
                result.unapplied.append(
                    f"{group.label}（{_hidden_reason(group, selected, by_key)}）"
                )
            continue
        max_codes = MAX_CODES_PER_GROUP if getattr(group, "multi", True) else 1
        valid: list[str] = []
        labels: list[str] = []
        dropped_extra = False
        for code in _codes_of(selected.get(key)):
            option = group.option(code)
            if option is None:
                # 任何一个 code 不在清单里，**只丢那一个**（不要整组丢弃）。
                result.unapplied.append(f"{group.label}：{code}（已失效）")
                continue
            if len(valid) >= max_codes:
                dropped_extra = True
                continue
            valid.append(code)
            labels.append(option.label)
        if dropped_extra:
            first = labels[0] if labels else ""
            suffix = f"（{first}）" if first else ""
            result.unapplied.append(f"{group.label}：站点这一项只支持单选，已按第一个生效{suffix}")
            logger.warning("多选条件里有一组只支持单选，已按第一个生效 key=%s", key)
        if not valid:
            continue
        # 多值用逗号连接：站点实测接受 `203,202` 形式（URL 里逗号必须保持字面量）。
        result.params[group.param] = ",".join(valid)
        result.applied.append(f"{group.label}：{'、'.join(labels)}")
    return result


__all__ = ["MAX_CODES_PER_GROUP", "UNLIMITED_CODE", "ResolvedFilters", "resolve_codes"]
