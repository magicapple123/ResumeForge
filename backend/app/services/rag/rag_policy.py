# SPDX-License-Identifier: Apache-2.0
"""RAG 的数据范围与字段白名单（计划 §3.1 / §3.4 / §5 的唯一判定点）。

**为什么 boost 只能出现在这些分区**：向量补召回只允许补充"哪些条目进入候选"，
不能在生成链里变成第二套排序来源。当前下游真正按岗位相关性重排条目的范围，是
profile_relevance._CONSUMED_VALUE_SECTIONS 的四个内置价值分区
（educations / experiences / campus_experiences / projects）；其余分区（awards、
skills、扩展栏目）与 filter_by_job=False 的自建板块，用户看到的行为是"按资料顺序 /
固定名额"，对它们 boost 等于绕过用户"这个板块不要按岗位筛"的显式选择。因此本模块
把可 boost 的分区收敛成一张白名单，并用测试钉住它与 _CONSUMED_VALUE_SECTIONS 逐字
一致：要扩名单，必须计划、下游打分与评测一起改。

其余判定同样只有一份实现：字段能不能进 embedding / 远程模型上下文只看
ConsumedFieldSpec.llm_allowed / private；自建板块主文本只认
paper_policy.custom_section_text_field()（R-37 单源，不在 RAG 里猜第二个字段）；
命中范围只认 (dataset_id, group_id) 精确相等——数据集 A 的向量不得命中数据集 B。
"""

from __future__ import annotations

from ...schemas.profile_projection import ConsumedEntry, ConsumedProfile, ConsumedSection
from ..profile.paper_policy import custom_section_text_field
from ..profile.profile_relevance_constants import (
    SECTION_PRIMARY_FIELDS,
    is_custom_section_key,
)

#: 允许 RAG boost 改变顺序的内置分区。
#: **必须与 profile_relevance._CONSUMED_VALUE_SECTIONS 逐字一致**（测试直接比对两边
#: 常量）：它是下游"岗位相关性重排"的作用范围，不是 RAG 自己的选择。
BOOSTABLE_BUILTIN_SECTIONS: tuple[str, ...] = (
    "educations",
    "experiences",
    "campus_experiences",
    "projects",
)


def _text(value: object) -> str:
    """字段值归一成去首尾空白的字符串；None 按空值处理。"""
    return str(value or "").strip()


def is_section_boostable(section_key: str, consumed: ConsumedProfile) -> bool:
    """该分区能否被 boost 改变条目顺序。

    - 内置四分区：在当前组参与清单里即可（用户已经选择让它们进这份简历）；
    - 自建板块（custom:<section_id>）：在参与清单里**且** filter_by_job 为 True
      ——False 是用户显式选择的"这个板块不要按岗位筛"，boost 改序等于绕过它；
    - 其余（awards / skills / 扩展栏目 / 未知 key）：一律 False。
    """
    if section_key not in consumed.participating_keys:
        return False
    if section_key in BOOSTABLE_BUILTIN_SECTIONS:
        return True
    if not is_custom_section_key(section_key):
        return False
    section = consumed.sections.get(section_key)
    return bool(section is not None and section.filter_by_job)


def boostable_sections(consumed: ConsumedProfile) -> tuple[str, ...]:
    """按用户的分区顺序返回可 boost 的分区键（去重，保持 section_order 顺序）。"""
    return tuple(
        key for key in dict.fromkeys(consumed.section_order) if is_section_boostable(key, consumed)
    )


def private_field_ids(section: ConsumedSection) -> tuple[str, ...]:
    """分区内"值不放行"的字段 id（定义顺序）：私密字段 + llm_allowed=False。

    这两类字段的值都不会出现在 entry_llm_values / custom_section_text 的返回值里；
    调用方需要归因"哪些字段被按住"时只拿 id。判据与 generation_postprocess 的
    spec.private or not spec.llm_allowed 同一口径。
    """
    return tuple(spec.field_id for spec in section.fields if spec.private or not spec.llm_allowed)


def entry_llm_values(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, str]:
    """条目中允许进入 embedding / 远程模型上下文的字段值（field_id → 值）。

    只收 llm_allowed 且非私密的字段（定义顺序、跳过空值）。不在白名单里的值
    （隐藏/已删除字段、未授权字段、私密字段）在这里就断掉，下游不能靠字符串
    黑名单再猜一次；需要知道"哪些字段被按住"用 private_field_ids。
    """
    values: dict[str, str] = {}
    for spec in section.fields:
        if spec.private or not spec.llm_allowed:
            continue
        value = _text(entry.values.get(spec.field_id))
        if value:
            values[spec.field_id] = value
    return values


def _primary_field_id(section: ConsumedSection, primary_key: str) -> str | None:
    """内置分区的主字段 key → 消费 DTO 的 field_id（entry.values 以 field_id 为键）。"""
    for spec in section.fields:
        if spec.key == primary_key:
            return spec.field_id
    return None


def _public_text(section: ConsumedSection, entry: ConsumedEntry, field_id: str | None) -> str:
    """按定义权限取一个字段的文本：私密 / 未授权 / 空值一律返回空串。"""
    if not field_id:
        return ""
    for spec in section.fields:
        if spec.field_id != field_id:
            continue
        if spec.private or not spec.llm_allowed:
            return ""
        return _text(entry.values.get(field_id))
    return ""


def custom_section_text(section: ConsumedSection, entry: ConsumedEntry) -> str:
    """自建板块条目的主文本；字段唯一来源是 paper_policy.custom_section_text_field。

    没有主文本字段（或主字段被隐藏/未授权/私密）返回空串——不在 RAG 里回退到
    "第一个多行字段"，否则与纸面投影变成两套形状（R-37 单源）。
    """
    return _public_text(section, entry, custom_section_text_field(section))


def _main_text(section: ConsumedSection, entry: ConsumedEntry) -> str:
    """条目主文本：自建板块按纸面主文本，内置分区按 SECTION_PRIMARY_FIELDS。"""
    if is_custom_section_key(section.key):
        return custom_section_text(section, entry)
    primary_key = SECTION_PRIMARY_FIELDS.get(section.key)
    if primary_key is None:
        # 单例分区（basic_info / summary）没有"条目"，不进 chunk。
        return ""
    return _public_text(section, entry, _primary_field_id(section, primary_key))


def is_entry_chunkable(section: ConsumedSection, entry: ConsumedEntry) -> bool:
    """该条目能否进入向量索引：主文本非空，且至少有一个可发送字段的值。"""
    return bool(_main_text(section, entry)) and bool(entry_llm_values(section, entry))


def scope_key(dataset_id: str, consumed: ConsumedProfile) -> tuple[str, str]:
    """索引 / 候选的命中范围：数据集 id + 当前资料组 id，缺一不可。"""
    return (str(dataset_id or ""), str(consumed.group_id or ""))


def is_same_scope(
    dataset_id: str,
    consumed: ConsumedProfile,
    candidate_dataset_id: str,
    candidate_group_id: str,
) -> bool:
    """候选是否属于同一数据集**且**同一资料组（数据集 A 的索引不得命中数据集 B）。"""
    return scope_key(dataset_id, consumed) == (
        str(candidate_dataset_id or ""),
        str(candidate_group_id or ""),
    )


__all__ = [
    "BOOSTABLE_BUILTIN_SECTIONS",
    "boostable_sections",
    "custom_section_text",
    "entry_llm_values",
    "is_entry_chunkable",
    "is_same_scope",
    "is_section_boostable",
    "private_field_ids",
    "scope_key",
]
