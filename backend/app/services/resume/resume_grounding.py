# SPDX-License-Identifier: Apache-2.0
"""grounding 公开入口与旧 ProfileOut 兼容门面（F3 §3）。

实现已按职责拆分（单文件预算）：
- grounding_entries：逐分区条目回填/标注 + **消费快照版** grounding（生成链路用）；
- resume_grounding_helpers：纯匹配、证据与参考事实工具（无状态）；
- 本模块：restore_selected_sections（扩展栏目整段回填，生成链路仍调用）与旧
  ProfileOut 兼容入口（既有单元测试/旧调用使用；生成链路已改走消费快照，不再用
  旧资料表拼候选）。

**为什么保留旧门面**：测试直接以 ground_resume_facts(resume, ProfileOut, ...) 验证
回填规则；F3 只改生成链路的取数来源，不改回填规则本身。把规则实现集中到
grounding_entries 后，旧门面成为"用 ProfileOut 组出 header/source_data 再调同一实现"
的窄适配层，行为逐字不变，也不会出现第二套匹配逻辑。
"""

from __future__ import annotations

from ...schemas.job import JobOut
from ...schemas.profile import ProfileOut
from ...schemas.resume import ResumeContent
from ..profile.profile_context import build_profile_prompt_data
from . import resume_grounding_helpers as _grounding_helpers
from .grounding_entries import ground_with_header
from .resume_content import coerce_resume
from .resume_grounding_helpers import (
    _build_grounded_summary,
    _enhance_or_restore_list,
    _enhance_or_restore_list_annotated,
    _find_source,
    _ground_list,
    _ground_or_restore_list,
    _ground_or_restore_list_annotated,
    _normalize_fact,
    _reference_fallback_facts,
    _selected_data_with_reference_fallbacks,
    _similar,
    _similar_skill,
    _source_evidence_text,
    _source_list,
    _source_value,
    _unsupported_quantified_values,
)

# Keep the historical private symbol importable while the implementation lives
# in the dedicated helper module.
_REFERENCE_FALLBACK_LIMITS = _grounding_helpers._REFERENCE_FALLBACK_LIMITS


def _header_from_profile(profile: ProfileOut) -> dict[str, str]:
    """旧 ProfileOut → 身份字段（ground_with_header 的输入）。"""
    return {
        "name": profile.name,
        "gender": profile.gender,
        "birth_year": profile.birth_year,
        "phone": profile.phone,
        "email": profile.email,
        "city": profile.city,
    }


def _candidate_data(selected_data: dict) -> dict:
    """兼容两种候选形态：纯候选字典（旧入口）与含 data 键的 selection_data（F3 新编排）。"""
    if isinstance(selected_data, dict) and isinstance(selected_data.get("data"), dict):
        return selected_data["data"]
    return selected_data


def restore_selected_sections(
    resume: ResumeContent,
    selected_data: dict,
    *,
    enhance: bool = False,
    enhancement_level: str = "balanced",
) -> ResumeContent:
    """回填模型错误遗漏的岗位候选区块（扩展栏目整段回填，旧行为不变）。"""
    candidate_data = _candidate_data(selected_data)
    fallback_source = (
        _selected_data_with_reference_fallbacks(candidate_data, enhancement_level)
        if enhance
        else candidate_data
    )
    fallback = coerce_resume(
        {
            "education": fallback_source.get("educations", []),
            "experience": fallback_source.get("experiences", []),
            "campus_experience": fallback_source.get("campus_experiences", []),
            "projects": fallback_source.get("projects", []),
            "skills": fallback_source.get("skills", []),
            "awards": fallback_source.get("awards", []),
            # A4：扩展事实的候选键与简历栏目同名（由 fact_context / Lead 合并进
            # selected_data）。候选里没有这些键时原样跳过，旧行为逐字不变。
            "publications": fallback_source.get("publications", []),
            "research_projects": fallback_source.get("research_projects", []),
            "patents": fallback_source.get("patents", []),
            "credentials": fallback_source.get("credentials", []),
        }
    )
    sections = {
        "education": "educations",
        "experience": "experiences",
        "campus_experience": "campus_experiences",
        "projects": "projects",
        "skills": "skills",
        "awards": "awards",
        # 扩展栏目：候选键与简历栏目同名（见 schemas/profile_facts 与 fact_context）。
        "publications": "publications",
        "research_projects": "research_projects",
        "patents": "patents",
        "credentials": "credentials",
    }
    updates = {
        output_field: getattr(fallback, output_field)
        for output_field, source_field in sections.items()
        if candidate_data.get(source_field) and not getattr(resume, output_field)
    }
    return resume.model_copy(update=updates) if updates else resume


def _legacy_ground_with_annotations(
    resume: ResumeContent,
    profile: ProfileOut,
    job: JobOut | None,
    selected_data: dict | None,
    *,
    enhance: bool,
    enhancement_level: str,
) -> tuple[ResumeContent, list[dict]]:
    """旧 ProfileOut 输入 → 身份 header + 候选数据 → 同一套回填实现。"""
    candidates = _candidate_data(selected_data) if selected_data else None
    source_data = candidates or build_profile_prompt_data(profile)
    header = _header_from_profile(profile)
    header["job_intent"] = (job.title if job else "") or profile.job_intent
    return ground_with_header(
        resume,
        header,
        source_data,
        job,
        enhance=enhance,
        enhancement_level=enhancement_level,
    )


def ground_resume_facts(
    resume: ResumeContent,
    profile: ProfileOut,
    job: JobOut | None,
    selected_data: dict | None = None,
    *,
    enhance: bool = False,
    enhancement_level: str = "balanced",
) -> ResumeContent:
    """把模型结果中的可验证字段锚定回资料库（旧 ProfileOut 兼容入口）。

    job is None 表示通用简历：求职意向沿用资料里用户自己写的那份。
    """
    content, _ = _legacy_ground_with_annotations(
        resume,
        profile,
        job,
        selected_data,
        enhance=enhance,
        enhancement_level=enhancement_level,
    )
    return content


def ground_resume_facts_with_annotations(
    resume: ResumeContent,
    profile: ProfileOut,
    job: JobOut | None,
    selected_data: dict | None = None,
    *,
    enhance: bool = False,
    enhancement_level: str = "balanced",
) -> tuple[ResumeContent, list[dict]]:
    """旧 ProfileOut 兼容版（RF-13 标注）：同时返回事实来源标注。"""
    return _legacy_ground_with_annotations(
        resume,
        profile,
        job,
        selected_data,
        enhance=enhance,
        enhancement_level=enhancement_level,
    )


__all__ = [
    "restore_selected_sections",
    "ground_resume_facts",
    "ground_resume_facts_with_annotations",
    "_similar",
    "_similar_skill",
    "_source_value",
    "_find_source",
    "_normalize_fact",
    "_ground_list",
    "_unsupported_quantified_values",
    "_source_list",
    "_ground_or_restore_list",
    "_ground_or_restore_list_annotated",
    "_source_evidence_text",
    "_enhance_or_restore_list",
    "_enhance_or_restore_list_annotated",
    "_build_grounded_summary",
    "_reference_fallback_facts",
    "_selected_data_with_reference_fallbacks",
    "_REFERENCE_FALLBACK_LIMITS",
]
