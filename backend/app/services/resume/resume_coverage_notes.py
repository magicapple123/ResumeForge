# SPDX-License-Identifier: Apache-2.0
"""覆盖度 note 的**唯一装配实现**：显式原因轴（5-A）与可确定性补入的条目 id（3-A）。

**为什么要单独成模块**：``resume_coverage.py`` 已经 400 行，而 note 的装配规则（四个
构造点共用同一套原因判定）与"哪个条目能被确定性补进简历"的取数规则都必须只有一份。
各写一遍的后果在 5-A 里已经出现过：个人总结那条的 ``names`` 带相似度后缀、
``model_omitted`` 只有「个人总结」，按名字对不上，原因就整条丢了。

**两个口径（写死在这里，前端不再推导）**

1. **原因轴**：一条 note 里三个数组（``filtered`` / ``capacity_omitted`` /
   ``model_omitted``）本来就是 ``names`` 的一个划分。显式 ``reasons: {name: reason}``
   只是把这个划分摊开写清楚，避免前端从"名字在哪个数组里"再猜一次。
   一个名字同时出现在多个桶里时按 ``capacity > filtered > model`` 取一条
   （与旧记录在前端的回退优先级逐条一致：旧记录没有 ``reasons``，前端用同一顺序推导，
   两边不会给出不同解释）。
2. **entry_ids**：只有"资料快照里能唯一定位到这一条"的名字才会出现在 ``entry_ids`` 里。
   定位不到（名字被截断、条目已删、或者调用方走的是只带身份名的旧入口）就**不写这个
   键**——前端据此区分"可以确定性补入的条目"与"只知道名字的旧记录"，不做任何猜测。

**entry_id 的作用域口径（3-A 风险项）**：``ResumeRecord`` 上没有绑定资料组，所以本模块
只接受调用方传进来的**一份** :class:`ConsumedProfile`，绝不在内部跨组查找。生产链路上
那份快照一律来自"当前组"（``load_ai_consumed_profile``，见 R-24：资料读取边界只能由
``profile_workspace_state`` 解析，请求体不能指定组），因此一条生成时快照的 entry_id 若
属于另一个组，在**当前组**里就查不到——调用方必须把它报成"该资料已删除/不在当前组"，
而不是静默跳过（见 ``resume_profile_append``）。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from ...schemas.profile_projection import ConsumedProfile
from ..profile.profile_custom_filter import custom_entry_label

#: 三条原因轴。名称是**协议值**（前后端共用，不做本地化）：前端按它查语言包。
CoverageReason = Literal["filtered", "capacity", "model"]

#: 一个名字落进多个桶时的取值优先级（与前端"旧记录回退推导"的顺序逐条一致）。
REASON_PRIORITY: tuple[CoverageReason, ...] = ("capacity", "filtered", "model")


def _reason_buckets(
    *,
    filtered: Sequence[str],
    capacity_omitted: Sequence[str],
    model_omitted: Sequence[str],
) -> dict[CoverageReason, set[str]]:
    """三个数组各自的集合（去重、忽略空串，保持与 ``names`` 相同的字符串口径）。"""
    return {
        "capacity": {str(name) for name in capacity_omitted if str(name)},
        "filtered": {str(name) for name in filtered if str(name)},
        "model": {str(name) for name in model_omitted if str(name)},
    }


def reasons_for(
    names: Sequence[str],
    *,
    filtered: Sequence[str] = (),
    capacity_omitted: Sequence[str] = (),
    model_omitted: Sequence[str] = (),
) -> dict[str, CoverageReason]:
    """``names`` 里每一条的显式原因；落在任何桶之外的名字**不猜**（前端显示「未说明」）。

    规格里把它叫作 ``_reasons_for``（"四处 note 构造统一走同一个"）；这里是它唯一的实现，
    ``resume_coverage`` 的四类构造点全部经 :func:`with_reasons` 调用，没有第二份。
    """
    buckets = _reason_buckets(
        filtered=filtered,
        capacity_omitted=capacity_omitted,
        model_omitted=model_omitted,
    )
    reasons: dict[str, CoverageReason] = {}
    for raw_name in names:
        name = str(raw_name)
        if not name:
            continue
        for reason in REASON_PRIORITY:
            if name in buckets[reason]:
                reasons[name] = reason
                break
    return reasons


def with_reasons(
    note: Mapping[str, Any],
    *,
    entry_ids: Sequence[str] | None = None,
) -> dict[str, Any]:
    """给一条 note 补上显式 ``reasons``（以及可选的 ``entry_ids``），返回**新字典**。

    - 已有 ``reasons`` 的 note（自建板块等由别处构造、将来也可能自己带上）原样保留：
      这里只补缺，不覆盖既有判定。
    - ``entry_ids`` 为空/None 时**不写这个键**：字段可选，旧记录的读侧必须能容忍它缺失，
      而"空数组"与"不知道"是两件事（前者会被前端当成"这条没有可补入的条目"）。
    """
    result = dict(note)
    names = [str(name) for name in (result.get("names") or []) if str(name)]
    if not result.get("reasons"):
        result["reasons"] = reasons_for(
            names,
            filtered=result.get("filtered") or (),
            capacity_omitted=result.get("capacity_omitted") or (),
            model_omitted=result.get("model_omitted") or (),
        )
    if entry_ids:
        existing = [str(item) for item in (result.get("entry_ids") or []) if str(item)]
        merged = list(existing)
        for entry_id in entry_ids:
            value = str(entry_id or "")
            if value and value not in merged:
                merged.append(value)
        result["entry_ids"] = merged
    return result


def builtin_entry_ids(
    consumed: ConsumedProfile,
    section_key: str,
    identity_field: str,
    names: Sequence[str],
) -> list[str]:
    """内置分区：按"身份字段值 → entry_id"定位（只认完全相等的名字，不做模糊匹配）。

    身份字段在消费快照里的键是 ``<分区>.<字段>``（如 ``projects.name``）。同一个名字出现
    两次时取第一条——资料侧本来就不该重名，这里不替用户裁决哪条更该补。
    """
    section = consumed.section(section_key)
    if section is None:
        return []
    field_id = f"{section_key}.{identity_field}"
    by_name: dict[str, str] = {}
    for entry in section.entries:
        value = str(entry.values.get(field_id) or "").strip()
        if value and value not in by_name:
            by_name[value] = entry.entry_id
    return [by_name[name] for name in names if name in by_name]


def custom_entry_ids(
    consumed: ConsumedProfile,
    section_key: str,
    names: Sequence[str],
) -> list[str]:
    """自建分区：按"条目可比对名字"（``custom_entry_label``）定位。

    名字口径与覆盖度清单同源（``profile_custom_filter.custom_entry_label``）：主文本字段
    优先、否则第一个有值的字段——换成分区标题或字段标签会因为"每条都一样"而全部撞车。
    """
    section = consumed.section(section_key)
    if section is None:
        return []
    by_name: dict[str, str] = {}
    for entry in section.entries:
        label = custom_entry_label(section, entry)
        if label and label not in by_name:
            by_name[label] = entry.entry_id
    return [by_name[name] for name in names if name in by_name]


__all__ = [
    "CoverageReason",
    "REASON_PRIORITY",
    "builtin_entry_ids",
    "custom_entry_ids",
    "reasons_for",
    "with_reasons",
]
