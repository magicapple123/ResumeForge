# SPDX-License-Identifier: Apache-2.0
"""岗位相关性筛选兼容门面。

实际职责按资料规范化、岗位匹配、参考文件和预算控制拆分到同目录模块；
本文件保留原有导入路径，并负责把这些纯函数编排成岗位专属候选上下文。
"""

from __future__ import annotations

import json
from typing import Any

from ...schemas.job import JobOut
from ...schemas.profile import ProfileOut
from .profile_budget import (
    _drop_one_detail,
    _dump,
    _trim_all_strings,
    _trim_middle,
    _trim_text,
    build_job_prompt_text,
    serialize_profile_prompt_data,
)
from .profile_context import (
    _reference_fields,
    build_llm_profile_prompt_data,
    build_profile_prompt_data,
    split_commas,
    split_lines,
)
from .profile_matching import (
    _contains,
    _item_text,
    _job_text,
    _matched_skills,
    _prioritize_item_details,
    _score_item,
    _select_entries,
    _select_ranked_items,
    _select_skills,
    _select_summary,
    _skill_domain_score,
    _take_entries,
    _unique,
    build_job_focus,
)
from .profile_references import (
    _clean_reference_fact_line,
    _prepare_general_reference_excerpt,
    _prepare_reference_excerpt,
    _reference_chunks,
    _reference_fact_candidates,
    _safe_reference_blocks,
    _select_reference_excerpt,
    _select_reference_facts,
    _strip_markdown,
)
from .profile_relevance_constants import (
    _ASCII_TERM_RE,
    _LIST_DETAIL_FIELDS,
    _LLM_PROFILE_FIELDS,
    _MARKDOWN_LIST_PREFIX_RE,
    _MARKDOWN_TABLE_DIVIDER_RE,
    _MIN_PROFILE_CONTEXT_CHARS,
    _OPTIONAL_TOP_LEVEL_FIELDS,
    _REFERENCE_CONTENT_KEY,
    _REFERENCE_EXCERPT_MAX_CHARS,
    _REFERENCE_FACT_LIMIT,
    _REFERENCE_FACT_MAX_CHARS,
    _REFERENCE_FILE_KEY,
    _REFERENCE_INSTRUCTION_RE,
    _REFERENCE_META_RE,
    _REFERENCE_SECTIONS,
    _TITLE_SPLIT_RE,
    DOMAIN_CONTEXT_SIGNALS,
    DOMAIN_SIGNALS,
    FACT_STANDALONE_SECTIONS,
    SECTION_LIMITS,
    SECTION_PRIMARY_FIELDS,
    SKILL_DOMAIN_HINTS,
    JobFocus,
    ProfileSelection,
)

_EMPTY_FOCUS = JobFocus(skills=(), domains=(), terms=())


def build_targeted_profile_context(
    profile: ProfileOut,
    job: JobOut,
    max_chars: int = 12_000,
    *,
    include_references: bool = False,
    fact_sections: dict[str, Any] | None = None,
) -> ProfileSelection:
    """构建岗位专属候选资料，并在边界安全的预算内序列化。

    fact_sections 是补充事实的六个 section（fact_context.prompt_sections 的输出）。
    它们**不参与岗位相关性排序**（契约 §3.3：排序算法不改）：按资料顺序保留到各自
    上限，进入预算压缩；作品/实践已在 build_profile_prompt_data 并入 projects/experiences。
    """
    full = build_profile_prompt_data(
        profile, include_references=include_references, fact_sections=fact_sections
    )
    focus = build_job_focus(job, profile)
    selected: dict[str, Any] = {
        key: value for key, value in full.items() if key not in SECTION_LIMITS
    }
    # A4/§8.5：跨行业 fallback 的触发条件——
    #   未识别出岗位领域（DOMAIN_SIGNALS 为空），并且要么没有显式技能信号（只有标题词，
    #   如会计/教师），要么至少有一个技能与资料命中（如门店运营的"排班管理"）。
    # 识别出领域但资料毫无证据（如 Kubernetes 岗位 + 通用软件资料）时**不**填充：
    # 那是诚实的"资料未提供"，塞入无关经历会诱导模型跑题（既有回归守着）。
    has_matched_skill = any(
        _score_item(item, "skills", focus) > 0
        for item in full["skills"]
        if str(item.get("name", "")).strip()
    )
    fallback_allowed = not focus.domains and (not focus.skills or has_matched_skill)
    # 当前岗位是本份简历的唯一求职意向；旧总结只保留有岗位交集的句子。
    selected["job_intent"] = job.title or full["job_intent"]
    selected["summary"] = _select_summary(full["summary"], focus)
    for section in ("educations", "experiences", "campus_experiences", "projects", "awards"):
        selected[section] = [
            _prepare_reference_excerpt(
                _prioritize_item_details(item, section, focus), section, focus
            )
            if include_references and section in _REFERENCE_SECTIONS
            else _prioritize_item_details(item, section, focus)
            for item in _select_entries(
                full[section], section, focus, fallback_allowed=fallback_allowed
            )
        ]
    for section in FACT_STANDALONE_SECTIONS:
        if section in full:
            selected[section] = _take_entries(full[section], section)
    evidence = {
        section: selected[section]
        for section in ("educations", "experiences", "campus_experiences", "projects")
    }
    selected["skills"] = _select_skills(
        full["skills"], evidence, focus, fallback_allowed=fallback_allowed
    )
    selected = build_llm_profile_prompt_data(selected)
    # 出现零分条目 ⇒ 这些条目是"信号不足兜底"保留的（正常路径有匹配时不混入零分条目）。
    # 生成说明据此加一句如实解释，避免用户误以为系统判定它们相关。
    fallback_sections: tuple[str, ...] = ()
    if fallback_allowed:
        fallback_sections = tuple(
            section
            for section in ("experiences", "projects")
            if any(_score_item(item, section, focus) == 0 for item in selected.get(section) or [])
        )
    return _assemble_selection(
        full, selected, focus, max_chars, fallback_sections=fallback_sections
    )


# 经历类分区 → 身份字段（判断"是不是同一条"）。键名与 resume_coverage.py 的比对表
# 共用同一套分区名——那边是消费方，两边不能各叫一套。
_IDENTITY_FIELDS: dict[str, str] = {
    "educations": "school",
    "experiences": "company",
    "campus_experiences": "organization",
    "projects": "name",
    "awards": "name",
    # A4 扩展栏目：论文/专利用标题、科研/证照用名称（与 resume_coverage._SECTION_MAP
    # 的身份字段逐字一致）。作品/实践已并入 projects/experiences，不在这里重复登记。
    "publications": "title",
    "research_projects": "name",
    "patents": "title",
    "credentials": "name",
}


def collect_entry_names(full: dict[str, Any]) -> dict[str, tuple[str, ...]]:
    """筛选前每段经历类分区里"都有谁"（按条目的身份字段）。

    生成结束后，覆盖度检查用它回答"我的某段经历为什么没写进简历"：
    没有这份清单，data 里就只剩被留下来的条目，说不清是"没被选中"还是"模型没写"。

    补充事实的独立 section 只在候选里真的有这个键时才登记：没有新事实时 entry_names
    的键集合与改动前完全一致（旧链路诊断文案不变）。
    """
    names: dict[str, tuple[str, ...]] = {}
    for section, field in _IDENTITY_FIELDS.items():
        if section in FACT_STANDALONE_SECTIONS and section not in full:
            continue
        values: list[str] = []
        for item in full.get(section) or []:
            if isinstance(item, dict):
                value = str(item.get(field) or "").strip()
                if value:
                    values.append(value)
        names[section] = tuple(values)
    return names


def _assemble_selection(
    full: dict[str, Any],
    selected: dict[str, Any],
    focus: JobFocus,
    max_chars: int,
    *,
    fallback_sections: tuple[str, ...] = (),
) -> ProfileSelection:
    """把已选好的候选资料做预算压缩并统计，供岗位与通用两条路径共用。"""
    serialized = serialize_profile_prompt_data(selected, max_chars)
    # serialize_profile_prompt_data 会在副本上做预算压缩；对外暴露的
    # data 必须与实际发送给模型的 JSON 完全一致，避免诊断和生成出现偏差。
    packed_data = json.loads(serialized)
    # 只统计**本次候选实际带上**的 section。没有补充事实时不出现新键，
    # selected_counts / omitted_counts 与改动前逐键相等（生成说明也不变）。
    counted_sections = [section for section in SECTION_LIMITS if section in packed_data]
    selected_counts = {section: len(packed_data[section]) for section in counted_sections}
    omitted_counts = {
        section: max(0, len(full.get(section) or []) - selected_counts[section])
        for section in counted_sections
    }
    return ProfileSelection(
        data=packed_data,
        serialized=serialized,
        focus=focus,
        selected_counts=selected_counts,
        omitted_counts=omitted_counts,
        # 筛选前的"都有谁"。生成结束后用它回答"我的某段经历为什么没写进简历"。
        entry_names=collect_entry_names(full),
        fallback_sections=fallback_sections,
    )


def build_general_profile_context(
    profile: ProfileOut,
    max_chars: int = 12_000,
    *,
    include_references: bool = False,
    fact_sections: dict[str, Any] | None = None,
) -> ProfileSelection:
    """构建**通用简历**的候选资料：不按岗位筛选，也不排序。

    做的是"全貌优先"：每个栏目按用户在资料页里的录入顺序取到该栏目上限，
    保留简历自己的求职意向与完整个人总结，校园经历同样保留（奖项在岗位路径上也会
    保留，见 ``_select_entries``）。

    **不要退化成"传一个空 focus 走岗位路径"**：那条路径在无信号时的行为并不是
    "保留全部"——它会丢掉校园经历、清空个人总结、并且只保留被证据提到的技能
    （见 ``_take_entries`` 的说明）。
    """
    full = build_profile_prompt_data(
        profile, include_references=include_references, fact_sections=fact_sections
    )
    selected: dict[str, Any] = {
        key: value for key, value in full.items() if key not in SECTION_LIMITS
    }
    # 求职意向沿用资料原文，不替换成任何岗位名；总结也保留用户自己写的那份。
    selected["summary"] = full["summary"]
    for section in ("educations", "experiences", "campus_experiences", "projects", "awards"):
        selected[section] = [
            _prepare_general_reference_excerpt(item)
            if include_references and section in _REFERENCE_SECTIONS
            else item
            for item in _take_entries(full[section], section)
        ]
    # 补充事实的独立 section：全貌优先路径同样保留（不因没有岗位信号被丢弃）。
    for section in FACT_STANDALONE_SECTIONS:
        if section in full:
            selected[section] = _take_entries(full[section], section)
    selected["skills"] = _take_entries(full["skills"], "skills")
    selected = build_llm_profile_prompt_data(selected)
    return _assemble_selection(full, selected, _EMPTY_FOCUS, max_chars)


def build_targeted_profile_prompt_data(
    profile: ProfileOut,
    job: JobOut,
    *,
    include_references: bool = False,
    fact_sections: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """公开的纯函数入口，便于测试岗位不同导致的候选资料差异。"""
    return build_targeted_profile_context(
        profile,
        job,
        include_references=include_references,
        fact_sections=fact_sections,
    ).data


__all__ = [
    "JobFocus",
    "ProfileSelection",
    "build_profile_prompt_data",
    "build_llm_profile_prompt_data",
    "build_job_focus",
    "build_job_prompt_text",
    "build_general_profile_context",
    "build_targeted_profile_context",
    "build_targeted_profile_prompt_data",
    "serialize_profile_prompt_data",
    "split_lines",
    "split_commas",
    "SECTION_LIMITS",
    "SECTION_PRIMARY_FIELDS",
    "DOMAIN_SIGNALS",
    "DOMAIN_CONTEXT_SIGNALS",
    "SKILL_DOMAIN_HINTS",
    "_TITLE_SPLIT_RE",
    "_ASCII_TERM_RE",
    "_LIST_DETAIL_FIELDS",
    "_OPTIONAL_TOP_LEVEL_FIELDS",
    "_LLM_PROFILE_FIELDS",
    "_MIN_PROFILE_CONTEXT_CHARS",
    "_REFERENCE_SECTIONS",
    "_REFERENCE_CONTENT_KEY",
    "_REFERENCE_FILE_KEY",
    "_REFERENCE_EXCERPT_MAX_CHARS",
    "_REFERENCE_FACT_MAX_CHARS",
    "_REFERENCE_FACT_LIMIT",
    "_REFERENCE_INSTRUCTION_RE",
    "_REFERENCE_META_RE",
    "_MARKDOWN_LIST_PREFIX_RE",
    "_MARKDOWN_TABLE_DIVIDER_RE",
    "_reference_fields",
    "_unique",
    "_contains",
    "_job_text",
    "_item_text",
    "_skill_domain_score",
    "_score_item",
    "_matched_skills",
    "_select_ranked_items",
    "_prioritize_item_details",
    "_select_summary",
    "_safe_reference_blocks",
    "_strip_markdown",
    "_clean_reference_fact_line",
    "_reference_fact_candidates",
    "_select_reference_facts",
    "_reference_chunks",
    "_select_reference_excerpt",
    "_prepare_reference_excerpt",
    "_select_entries",
    "_select_skills",
    "_dump",
    "_trim_text",
    "_trim_middle",
    "_drop_one_detail",
    "_trim_all_strings",
]
