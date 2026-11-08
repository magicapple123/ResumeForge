# SPDX-License-Identifier: Apache-2.0
"""自建板块的「参与岗位相关性筛选」开关（问题清单 需求 6）。

**问题**：内置分区按身份字段 + JD 关键词打分（``profile_matching._select_entries``），
自建板块（``custom:<section_id>``）没有统一身份字段，于是它们**无条件**全量进入简历——
一份运营相关的「证书与作品」会原样出现在后端岗、前端岗的简历里。用户此前没有任何开关。

**这个模块只做三件事**：

1. 把一条自建条目压成可检索语料（主文本字段优先，没有就用全部字段值——即需求里的
   "B 为主 + A 兜底"）；
2. 用**内置分区同一个打分函数**（``profile_matching._score_item``，同一个 ``JobFocus``）
   判断它是否与岗位有交集，产出"哪些条目进候选"的确定性计划；
3. 按同一份计划回答"哪些条目没写进简历、为什么"，供 ``coverage_notes`` 如实告知。

**为什么不另写一套打分**：内置分区的判据是"JD 技能命中 +12 / 关键词命中 +3 / 领域信号
+2 +1"，自建板块若自己定一套阈值，用户会看到"同样的词在我的项目里算命中、在自建板块里
不算"。所以这里只调用 ``_score_item``，连 section 权重也沿用非经历类分区（+3）的口径，
唯一的自定规则是 ``_select_entries`` 里那条"有明确匹配时只保留命中的条目"。

**开关关（默认）= 行为与今天逐字节一致**：计划里根本没有这个板块，``attach_custom_sections``
拿到的还是原始快照。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from ...schemas.profile_projection import ConsumedEntry, ConsumedProfile, ConsumedSection
from ...schemas.resume import ResumeContent
from ..rag import rag_seam as _rag_seam
from .paper_policy import custom_section_text_field
from .profile_matching import _score_item
from .profile_relevance_constants import JobFocus

# 与 ``resume_coverage._SECTION_MAP`` 同一口径的条目名比对容忍度：模型/投影可能把长文本
# 截断，所以允许双向包含；但两边都短于这个长度时只认完全相等，避免"证书"命中"证书A"。
_MIN_CONTAINMENT_CHARS = 4

_CUSTOM_PREFIX = "custom:"


@dataclass(frozen=True)
class CustomSectionFilter:
    """一次生成对自建板块的确定性取舍结果（只读，不回调数据库）。"""

    #: 参与筛选的板块 key（只有开了开关、且有条目的板块才在里面）。
    keys: tuple[str, ...] = ()
    #: key → 入选条目的 entry_id（消费快照里的原始 id，不是纸面上截断的那一份）。
    kept: Mapping[str, frozenset[str]] = field(default_factory=dict)
    #: key → 板块名（用户改过的名字，如实展示）。
    names: Mapping[str, str] = field(default_factory=dict)
    #: key → 全部条目的 entry_id（算 omitted 用）。
    totals: Mapping[str, int] = field(default_factory=dict)
    #: key → 被筛掉的条目名（coverage_notes 直接引用，不做二次推断）。
    dropped: Mapping[str, tuple[str, ...]] = field(default_factory=dict)

    @property
    def active(self) -> bool:
        return bool(self.keys)

    def counts(self) -> list[dict[str, Any]]:
        """给生成说明的「候选资料组成」：板块名 + 入选条数 + 总条数。"""
        return [
            {
                "key": key,
                "name": self.names.get(key, key),
                "selected": len(self.kept.get(key) or ()),
                "total": int(self.totals.get(key, 0)),
            }
            for key in self.keys
        ]


def _clean(value: Any) -> str:
    return str(value or "").strip()


def custom_entry_label(section: ConsumedSection, entry: ConsumedEntry) -> str:
    """条目的可比对名字：主文本字段优先，否则第一个有值的字段。

    没有主文本字段时退回"第一个有值的字段"而不是字段标签——标签是用户给字段起的名
    （「颁发机构」），同一板块里每条都一样，拿来当身份会在覆盖度里全部撞成一条。
    """
    text_field = custom_section_text_field(section)
    if text_field:
        value = _clean(entry.values.get(text_field))
        if value:
            return value
    for spec in section.fields:
        value = _clean(entry.values.get(spec.field_id))
        if value:
            return value
    return ""


def custom_entry_corpus(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    """条目的检索语料：主文本 + 全部字段值（与内置分区的 ``_item_text`` 同一形态）。"""
    text_field = custom_section_text_field(section)
    values = [
        _clean(entry.values.get(spec.field_id))
        for spec in section.fields
        if _clean(entry.values.get(spec.field_id))
    ]
    corpus: dict[str, Any] = {"text": _clean(entry.values.get(text_field)) if text_field else ""}
    corpus["values"] = values
    return corpus


def _boosted_by_rag(
    section: ConsumedSection, entry: ConsumedEntry, boost: Mapping[str, float] | None
) -> bool:
    """该自建条目是否有 RAG boost 命中（canonical hash 与 chunk 侧同一实现）。"""
    if not boost:
        return False
    from ..rag.rag_chunking import canonical_item_hash

    value = boost.get(canonical_item_hash(section.key, custom_entry_corpus(section, entry)), 0.0)
    return float(value) > 0.0


def plan_custom_section_filter(
    consumed: ConsumedProfile | None, focus: JobFocus | None
) -> CustomSectionFilter:
    """按岗位信号算出"哪些自建条目进候选"。

    ``focus`` 为空（通用简历 / 旧链路）或 ``consumed`` 为空时返回空计划——没有岗位就
    没有"相关性"可言，行为必须与改动前完全一致。
    """
    if consumed is None or focus is None:
        return CustomSectionFilter()
    if not (focus.skills or focus.domains or focus.terms):
        # JD 里没有任何可识别信号：没有"相关性"可判，全量保留（与 _select_entries 在
        # 无信号时的分支一致），也不把它算作"参与筛选的板块"。
        return CustomSectionFilter()
    keys: list[str] = []
    kept: dict[str, frozenset[str]] = {}
    names: dict[str, str] = {}
    totals: dict[str, int] = {}
    dropped: dict[str, tuple[str, ...]] = {}
    for key, section in consumed.sections.items():
        if not key.startswith(_CUSTOM_PREFIX) or not section.filter_by_job:
            continue
        entries = [entry for entry in section.entries if custom_entry_label(section, entry)]
        if not entries:
            continue
        boost = _rag_seam.active_boost()
        selected = [
            entry
            for entry in entries
            if _score_item(custom_entry_corpus(section, entry), _CUSTOM_PREFIX, focus) > 0
            # Phase 3：只有 filter_by_job=True 的自建板块会走到这里；boost 让"用词不同
            # 但语义相关"的条目也能被召回，不改变板块/条目的原始顺序。
            or _boosted_by_rag(section, entry, boost)
        ]
        keys.append(key)
        names[key] = section.name
        totals[key] = len(entries)
        kept[key] = frozenset(entry.entry_id for entry in selected)
        chosen = {entry.entry_id for entry in selected}
        dropped[key] = tuple(
            label
            for label in (
                custom_entry_label(section, entry)
                for entry in entries
                if entry.entry_id not in chosen
            )
            if label
        )
    if not keys:
        return CustomSectionFilter()
    return CustomSectionFilter(
        keys=tuple(keys), kept=kept, names=names, totals=totals, dropped=dropped
    )


def apply_custom_section_filter(
    consumed: ConsumedProfile, plan: CustomSectionFilter | None
) -> ConsumedProfile:
    """把计划落到消费快照上（只裁自建板块的 entries，其它分区逐字不动）。"""
    if plan is None or not plan.active:
        return consumed
    sections: dict[str, ConsumedSection] = {}
    for key, section in consumed.sections.items():
        allowed = plan.kept.get(key)
        if allowed is None:
            sections[key] = section
            continue
        sections[key] = replace(
            section, entries=tuple(entry for entry in section.entries if entry.entry_id in allowed)
        )
    return replace(consumed, sections=sections)


def _normalized(text: str) -> str:
    return re.sub(r"\s+", "", text).casefold()


def _same_entry_name(left: str, right: str) -> bool:
    a, b = _normalized(left), _normalized(right)
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) < _MIN_CONTAINMENT_CHARS:
        return False
    return a in b or b in a


def _written_custom_names(resume: ResumeContent, section_key: str) -> list[str]:
    """简历里该自建板块实际写进去的条目名（主文本优先，否则第一行「标签：值」）。"""
    names: list[str] = []
    for section in resume.custom_sections:
        if section.key != section_key:
            continue
        for entry in section.entries:
            text = _clean(entry.text)
            if not text:
                text = next((_clean(line.value) for line in entry.lines if _clean(line.value)), "")
            if text:
                names.append(text)
    return names


def find_unwritten_custom_details(
    resume: ResumeContent,
    consumed: ConsumedProfile | None,
    plan: CustomSectionFilter | None,
) -> list[dict[str, Any]]:
    """被开关筛掉的自建条目 → ``coverage_notes`` 的一项（与内置分区同一形状）。

    只报**参与了筛选**的板块：开关关着的板块无条件全量进简历，报"未写入"只会吓人。
    ``filtered`` 是"关卡 1（岗位相关性）拦下的"，``model_omitted`` 恒为空——自建板块
    由服务端确定性投影写入，模型没有取舍权，混进"模型没写"会是假原因。
    """
    if plan is None or not plan.active or consumed is None:
        return []
    details: list[dict[str, Any]] = []
    for key in plan.keys:
        section = consumed.section(key)
        if section is None:
            continue
        written = _written_custom_names(resume, key)
        missing = [
            label
            for label in plan.dropped.get(key, ())
            if not any(_same_entry_name(label, name) for name in written)
        ]
        if not missing:
            continue
        kept = len(plan.kept.get(key) or ())
        details.append(
            {
                "section": key,
                "section_label": plan.names.get(key, section.name),
                "names": sorted(missing),
                "filtered": sorted(missing),
                "model_omitted": [],
                "total": int(plan.totals.get(key, len(section.entries))),
                "selected": kept,
            }
        )
    return details


__all__ = [
    "CustomSectionFilter",
    "apply_custom_section_filter",
    "custom_entry_corpus",
    "custom_entry_label",
    "find_unwritten_custom_details",
    "plan_custom_section_filter",
]
