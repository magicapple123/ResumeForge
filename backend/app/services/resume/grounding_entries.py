# SPDX-License-Identifier: Apache-2.0
"""条目级 grounding：把模型简历条目锚定回本次消费快照的候选数据（F3 §3）。

从 resume_grounding.py 拆出（单文件 ≤300 预算）：本模块放"逐分区条目回填/标注"与
"消费快照版 grounding"的实现；resume_grounding.py 只保留 ProfileOut 兼容门面、身份/
summary 恢复与公开入口，并 re-export 这里的实现，既有导入路径不变。

**数据来源只有本次快照**（F3 §3）：新路径的候选数据来自 F3-A 冻结的
selection_data["data"]（已按当前组过滤）；身份/基本信息来自 ConsumedProfile 的
basic_info，不读旧 user_profile、不从未过滤资料补 hidden/组外值。旧 ProfileOut 门面
仅服务既有单元测试，生成链路不再走它。

**行为等价**：逐分区逻辑从 resume_grounding.py 原样搬迁（路径/标注/回填规则逐字
保留），拆分只搬位置、不改语义（既有 test_resume_fact_annotations 等用例继续守护）。
"""

from __future__ import annotations

import json
from typing import Any

from ...schemas.job import JobOut
from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from .resume_grounding_helpers import (
    _build_grounded_summary,
    _enhance_or_restore_list_annotated,
    _find_source,
    _ground_or_restore_list_annotated,
    _reference_fallback_facts,
    _similar_skill,
    _source_evidence_text,
    _source_list,
    _source_value,
    _unsupported_quantified_values,
)

_Annotations = list[dict[str, Any]]


def ground_education_items(
    items: list[Any], source_data: dict, *, enhance: bool, enhancement_level: str
) -> tuple[list[Any], _Annotations]:
    education_items: list[Any] = []
    annotations: _Annotations = []
    for item in items:
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
                achievement_notes = [{"origin": "restored", "source_fact": "；".join(achievements)}]
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
    return education_items, annotations


def ground_experience_items(
    items: list[Any], source_data: dict, *, enhance: bool, enhancement_level: str
) -> tuple[list[Any], _Annotations]:
    experience_items: list[Any] = []
    annotations: _Annotations = []
    for item in items:
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
                description_notes = [{"origin": "restored", "source_fact": "；".join(description)}]
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
    return experience_items, annotations


def ground_campus_items(
    items: list[Any], source_data: dict, *, enhance: bool, enhancement_level: str
) -> tuple[list[Any], _Annotations]:
    campus_items: list[Any] = []
    annotations: _Annotations = []
    for item in items:
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
                description_notes = [{"origin": "restored", "source_fact": "；".join(description)}]
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
    return campus_items, annotations


def ground_project_items(
    items: list[Any], source_data: dict, *, enhance: bool, enhancement_level: str
) -> tuple[list[Any], _Annotations]:
    project_items: list[Any] = []
    annotations: _Annotations = []
    for item in items:
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
                description_notes = [{"origin": "restored", "source_fact": "；".join(description)}]
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
    return project_items, annotations


def ground_skill_items(
    items: list[Any], source_data: dict, *, enhance: bool, enhancement_level: str
) -> tuple[list[Any], _Annotations]:
    del enhance, enhancement_level  # 技能回填与美化档位无关（旧行为）
    skill_items: list[Any] = []
    annotations: _Annotations = []
    for item in items:
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
    return skill_items, annotations


def ground_award_items(
    items: list[Any], source_data: dict, *, enhance: bool, enhancement_level: str
) -> tuple[list[Any], _Annotations]:
    del enhance, enhancement_level  # 奖项回填与美化档位无关（旧行为）
    award_items: list[Any] = []
    annotations: _Annotations = []
    for item in items:
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
    return award_items, annotations


def ground_summary(
    resume_summary: str, source_data: dict, job: JobOut | None, *, enhance: bool
) -> tuple[str, _Annotations]:
    """summary 的"模型被丢弃 / 改写保留"判定与回填（从旧实现原样搬迁）。"""
    grounded_summary = _build_grounded_summary(source_data, job)
    summary_evidence = json.dumps(source_data, ensure_ascii=False)
    summary = resume_summary.strip() if enhance else ""
    if not summary or _unsupported_quantified_values(summary, summary_evidence):
        return grounded_summary, [
            {"path": "summary", "origin": "restored", "source_fact": grounded_summary}
        ]
    if enhance:
        return summary, [{"path": "summary", "origin": "enhanced_kept"}]
    return summary, []


def ground_with_header(
    resume: ResumeContent,
    header: dict[str, str],
    source_data: dict,
    job: JobOut | None,
    *,
    enhance: bool,
    enhancement_level: str,
) -> tuple[ResumeContent, _Annotations]:
    """身份/summary 与六个旧条目分区的确定性回填（旧行为的唯一实现）。

    header 是身份字段的来源（旧路径来自 ProfileOut、新路径来自消费快照的 basic_info）；
    两者都只提供"用户自己写的身份值"，条目匹配仍只依赖 source_data。
    """
    annotations: _Annotations = []
    result = resume.model_copy(update=header)
    summary, summary_notes = ground_summary(resume.summary, source_data, job, enhance=enhance)
    annotations.extend(summary_notes)
    result = result.model_copy(update={"summary": summary})
    education_items, notes = ground_education_items(
        result.education, source_data, enhance=enhance, enhancement_level=enhancement_level
    )
    annotations.extend(notes)
    result = result.model_copy(update={"education": education_items})
    experience_items, notes = ground_experience_items(
        result.experience, source_data, enhance=enhance, enhancement_level=enhancement_level
    )
    annotations.extend(notes)
    result = result.model_copy(update={"experience": experience_items})
    campus_items, notes = ground_campus_items(
        result.campus_experience,
        source_data,
        enhance=enhance,
        enhancement_level=enhancement_level,
    )
    annotations.extend(notes)
    result = result.model_copy(update={"campus_experience": campus_items})
    project_items, notes = ground_project_items(
        result.projects, source_data, enhance=enhance, enhancement_level=enhancement_level
    )
    annotations.extend(notes)
    result = result.model_copy(update={"projects": project_items})
    skill_items, notes = ground_skill_items(
        result.skills, source_data, enhance=enhance, enhancement_level=enhancement_level
    )
    annotations.extend(notes)
    result = result.model_copy(update={"skills": skill_items})
    award_items, notes = ground_award_items(
        result.awards, source_data, enhance=enhance, enhancement_level=enhancement_level
    )
    annotations.extend(notes)
    return result.model_copy(update={"awards": award_items}), annotations


def _basic_values(consumed: ConsumedProfile) -> dict[str, str]:
    section = consumed.section("basic_info")
    if section is None or not section.entries:
        return {}
    return dict(section.entries[0].values)


def header_from_consumed(consumed: ConsumedProfile, job: JobOut | None) -> dict[str, str]:
    """身份字段从消费快照的 basic_info 取（不读旧 user_profile）。"""
    values = _basic_values(consumed)
    job_title = str(getattr(job, "title", "") or "").strip() if job is not None else ""
    return {
        "name": values.get("basic_info.name", ""),
        "gender": values.get("basic_info.gender", ""),
        # 旧模型的 birth_year 列对应新定义的"出生年月"（值仍允许只写年份）。
        "birth_year": values.get("basic_info.birth_month", ""),
        "phone": values.get("basic_info.phone", ""),
        "email": values.get("basic_info.email", ""),
        "city": values.get("basic_info.city", ""),
        "job_intent": job_title or values.get("basic_info.job_intention", ""),
    }


def ground_consumed_resume_facts_with_annotations(
    resume: ResumeContent,
    consumed: ConsumedProfile,
    job: JobOut | None,
    selection_data: dict[str, Any],
    *,
    enhance: bool = False,
    enhancement_level: str = "balanced",
) -> tuple[ResumeContent, _Annotations]:
    """生成链路的新入口：只用本次消费快照 + 已过滤候选数据完成 grounding。"""
    source_data = dict(selection_data.get("data") or {})
    header = header_from_consumed(consumed, job)
    result, annotations = ground_with_header(
        resume,
        header,
        source_data,
        job,
        enhance=enhance,
        enhancement_level=enhancement_level,
    )
    photo = str(_basic_values(consumed).get("basic_info.photo") or "").strip()
    if photo:
        result = result.model_copy(update={"photo": photo})
    return result, annotations


# 生成链路按约定从本模块 import 的名字（与旧入口同名、语义=消费快照版）。
ground_resume_facts_with_annotations = ground_consumed_resume_facts_with_annotations


__all__ = [
    "ground_award_items",
    "ground_campus_items",
    "ground_consumed_resume_facts_with_annotations",
    "ground_education_items",
    "ground_experience_items",
    "ground_project_items",
    "ground_resume_facts_with_annotations",
    "ground_skill_items",
    "ground_summary",
    "ground_with_header",
    "header_from_consumed",
]
