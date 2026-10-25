# SPDX-License-Identifier: Apache-2.0
"""把模型简历结果锚定回用户资料中的可验证事实。"""

from __future__ import annotations

import json

from ...schemas.job import JobOut
from ...schemas.profile import ProfileOut
from ...schemas.resume import ResumeContent
from ..profile.profile_context import build_profile_prompt_data
from . import resume_grounding_helpers as _grounding_helpers
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

def restore_selected_sections(
    resume: ResumeContent,
    selected_data: dict,
    *,
    enhance: bool = False,
    enhancement_level: str = "balanced",
) -> ResumeContent:
    """回填模型错误遗漏的岗位候选区块。"""
    fallback_source = (
        _selected_data_with_reference_fallbacks(selected_data, enhancement_level)
        if enhance
        else selected_data
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
        if selected_data.get(source_field) and not getattr(resume, output_field)
    }
    return resume.model_copy(update=updates) if updates else resume


def ground_resume_facts(
    resume: ResumeContent,
    profile: ProfileOut,
    job: JobOut | None,
    selected_data: dict | None = None,
    *,
    enhance: bool = False,
    enhancement_level: str = "balanced",
) -> ResumeContent:
    """把模型结果中的可验证字段锚定回资料库。

    ``job is None`` 表示通用简历：求职意向沿用资料里用户自己写的那份。
    """
    content, _ = _ground_resume_facts_with_annotations(
        resume, profile, job, selected_data,
        enhance=enhance, enhancement_level=enhancement_level,
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
    """:func:`ground_resume_facts` 的标注版（RF-13）：同时返回事实来源标注。

    标注是纯收集——锚定过程中"哪个 source 条目匹配上了"本来就算出来了，
    现在把它留下来，而不是算完就扔。不调模型、不改变任何内容值。
    """
    return _ground_resume_facts_with_annotations(
        resume, profile, job, selected_data,
        enhance=enhance, enhancement_level=enhancement_level,
    )


def _ground_resume_facts_with_annotations(
    resume: ResumeContent,
    profile: ProfileOut,
    job: JobOut | None,
    selected_data: dict | None,
    *,
    enhance: bool,
    enhancement_level: str,
) -> tuple[ResumeContent, list[dict]]:
    """锚定的唯一实现；``annotations`` 记录每段内容的来源（grounded/restored/enhanced_kept）。

    标注粒度：条目级（``education.0`` 等，来源条目匹配成功 → ``grounded``）+ 字段级
    （仅 ``restored`` / ``enhanced_kept`` 时补一条，说明这一栏是回填原文或 AI 改写保留）。
    """
    annotations: list[dict] = []
    source_data = selected_data or build_profile_prompt_data(profile)
    result = resume.model_copy(
        update={
            "name": profile.name,
            "gender": profile.gender,
            "birth_year": profile.birth_year,
            "phone": profile.phone,
            "email": profile.email,
            "city": profile.city,
            "job_intent": (job.title if job else "") or profile.job_intent,
        }
    )
    grounded_summary = _build_grounded_summary(source_data, job)
    summary_evidence = json.dumps(source_data, ensure_ascii=False)
    summary = resume.summary.strip() if enhance else ""
    if not summary or _unsupported_quantified_values(summary, summary_evidence):
        summary = grounded_summary
        # 模型的总结被丢弃，用代码从已选事实重建：如实标注为"回填"。
        annotations.append(
            {"path": "summary", "origin": "restored", "source_fact": grounded_summary}
        )
    elif enhance:
        # 美化模式下模型写的总结保留了下来（量化断言已过校验）：AI 改写，非已确认。
        annotations.append({"path": "summary", "origin": "enhanced_kept"})
    result = result.model_copy(update={"summary": summary})

    education_items = []
    for item in result.education:
        source = _find_source(item, source_data.get("educations", []), "school", "major")
        if source is None:
            continue
        source_achievements = _source_list(source, "achievements")
        if enhance:
            achievements, achievement_notes = _enhance_or_restore_list_annotated(
                item.achievements,
                source_achievements,
                _source_evidence_text(source, ("achievements",)),
            )
        else:
            achievements, achievement_notes = _ground_or_restore_list_annotated(
                item.achievements, source_achievements
            )
        if enhance and not achievements:
            achievements = _reference_fallback_facts(source, enhancement_level)
            if achievements:
                achievement_notes = [
                    {"origin": "restored", "source_fact": "；".join(achievements)}
                ]
        courses, course_notes = _ground_or_restore_list_annotated(
            item.courses, _source_list(source, "courses")
        )
        education_items.append(
            item.model_copy(
                update={
                    "school": _source_value(source, "school"),
                    "major": _source_value(source, "major"),
                    "degree": _source_value(source, "degree"),
                    "start_date": _source_value(source, "start_date"),
                    "end_date": _source_value(source, "end_date"),
                    "gpa": _source_value(source, "gpa"),
                    "courses": courses,
                    "achievements": achievements,
                }
            )
        )
        item_index = len(education_items) - 1
        annotations.append(
            {
                "path": f"education.{item_index}",
                "origin": "grounded",
                "source_subject": _source_value(source, "school"),
                "source_fact": "；".join(source_achievements) or None,
            }
        )
        for field, notes in (("achievements", achievement_notes), ("courses", course_notes)):
            annotations.extend(
                {"path": f"education.{item_index}.{field}", **note}
                for note in notes
                if note["origin"] != "grounded"
            )
    result = result.model_copy(update={"education": education_items})

    experience_items = []
    for item in result.experience:
        source = _find_source(item, source_data.get("experiences", []), "company", "role")
        if source is None:
            continue
        source_description = _source_list(source, "description")
        if enhance:
            description, description_notes = _enhance_or_restore_list_annotated(
                item.description,
                source_description,
                _source_evidence_text(source, ("description",)),
            )
        else:
            description, description_notes = _ground_or_restore_list_annotated(
                item.description, source_description
            )
        if enhance and not description:
            description = _reference_fallback_facts(source, enhancement_level)
            if description:
                description_notes = [
                    {"origin": "restored", "source_fact": "；".join(description)}
                ]
        experience_items.append(
            item.model_copy(
                update={
                    "company": _source_value(source, "company"),
                    "role": _source_value(source, "role"),
                    "start_date": _source_value(source, "start_date"),
                    "end_date": _source_value(source, "end_date"),
                    "description": description,
                }
            )
        )
        item_index = len(experience_items) - 1
        annotations.append(
            {
                "path": f"experience.{item_index}",
                "origin": "grounded",
                "source_subject": _source_value(source, "company"),
                "source_fact": "；".join(source_description) or None,
            }
        )
        annotations.extend(
            {"path": f"experience.{item_index}.description", **note}
            for note in description_notes
            if note["origin"] != "grounded"
        )
    result = result.model_copy(update={"experience": experience_items})

    campus_items = []
    for item in result.campus_experience:
        source = _find_source(
            item, source_data.get("campus_experiences", []), "organization", "role"
        )
        if source is None:
            continue
        source_description = _source_list(source, "description")
        if enhance:
            description, description_notes = _enhance_or_restore_list_annotated(
                item.description,
                source_description,
                _source_evidence_text(source, ("description",)),
            )
        else:
            description, description_notes = _ground_or_restore_list_annotated(
                item.description, source_description
            )
        if enhance and not description:
            description = _reference_fallback_facts(source, enhancement_level)
            if description:
                description_notes = [
                    {"origin": "restored", "source_fact": "；".join(description)}
                ]
        campus_items.append(
            item.model_copy(
                update={
                    "organization": _source_value(source, "organization"),
                    "role": _source_value(source, "role"),
                    "start_date": _source_value(source, "start_date"),
                    "end_date": _source_value(source, "end_date"),
                    "description": description,
                }
            )
        )
        item_index = len(campus_items) - 1
        annotations.append(
            {
                "path": f"campus_experience.{item_index}",
                "origin": "grounded",
                "source_subject": _source_value(source, "organization"),
                "source_fact": "；".join(source_description) or None,
            }
        )
        annotations.extend(
            {"path": f"campus_experience.{item_index}.description", **note}
            for note in description_notes
            if note["origin"] != "grounded"
        )
    result = result.model_copy(update={"campus_experience": campus_items})

    project_items = []
    for item in result.projects:
        source = _find_source(item, source_data.get("projects", []), "name", "role")
        if source is None:
            continue
        source_description = _source_list(source, "description")
        source_highlights = _source_list(source, "highlights")
        source_evidence = _source_evidence_text(source, ("description", "highlights"))
        if enhance:
            description, description_notes = _enhance_or_restore_list_annotated(
                item.description, source_description, source_evidence
            )
            highlights, highlight_notes = _enhance_or_restore_list_annotated(
                item.highlights, source_highlights, source_evidence
            )
        else:
            description, description_notes = _ground_or_restore_list_annotated(
                item.description, source_description
            )
            highlights, highlight_notes = _ground_or_restore_list_annotated(
                item.highlights, source_highlights
            )
        if enhance and not description and not highlights:
            description = _reference_fallback_facts(source, enhancement_level)
            if description:
                description_notes = [
                    {"origin": "restored", "source_fact": "；".join(description)}
                ]
        tech_stack, tech_stack_notes = _ground_or_restore_list_annotated(
            item.tech_stack, _source_list(source, "tech_stack")
        )
        project_items.append(
            item.model_copy(
                update={
                    "name": _source_value(source, "name"),
                    "role": _source_value(source, "role"),
                    "start_date": _source_value(source, "start_date"),
                    "end_date": _source_value(source, "end_date"),
                    "tech_stack": tech_stack,
                    "description": description,
                    "highlights": highlights,
                }
            )
        )
        item_index = len(project_items) - 1
        annotations.append(
            {
                "path": f"projects.{item_index}",
                "origin": "grounded",
                "source_subject": _source_value(source, "name"),
                "source_fact": "；".join([*source_description, *source_highlights]) or None,
            }
        )
        for field, notes in (
            ("description", description_notes),
            ("highlights", highlight_notes),
            ("tech_stack", tech_stack_notes),
        ):
            annotations.extend(
                {"path": f"projects.{item_index}.{field}", **note}
                for note in notes
                if note["origin"] != "grounded"
            )
    result = result.model_copy(update={"projects": project_items})

    skill_items = []
    for item in result.skills:
        source = next(
            (
                skill
                for skill in source_data.get("skills", [])
                if _similar_skill(item.name, _source_value(skill, "name"))
            ),
            None,
        )
        if source is None:
            continue
        skill_items.append(
            item.model_copy(
                update={
                    "name": _source_value(source, "name"),
                    "level": _source_value(source, "level"),
                }
            )
        )
        item_index = len(skill_items) - 1
        annotations.append(
            {
                "path": f"skills.{item_index}",
                "origin": "grounded",
                "source_subject": _source_value(source, "name"),
                "source_fact": _source_value(source, "name") or None,
            }
        )
    result = result.model_copy(update={"skills": skill_items})

    award_items = []
    for item in result.awards:
        source = _find_source(item, source_data.get("awards", []), "name")
        if source is None:
            continue
        award_items.append(
            item.model_copy(
                update={
                    "name": _source_value(source, "name"),
                    "date": _source_value(source, "date"),
                    "description": _source_value(source, "description"),
                }
            )
        )
        item_index = len(award_items) - 1
        annotations.append(
            {
                "path": f"awards.{item_index}",
                "origin": "grounded",
                "source_subject": _source_value(source, "name"),
                "source_fact": _source_value(source, "description") or None,
            }
        )
    return result.model_copy(update={"awards": award_items}), annotations


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
]
