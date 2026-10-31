# SPDX-License-Identifier: Apache-2.0
"""生成简历与候选资料之间的一致性检查。

**F3 取数口径**：生成链路只读本次冻结的消费快照——新入口 check_consistency(resume,
consumed, selection_data, source_label=...) 的 source_data 来自 selection_data["data"]
（已按当前组过滤的候选），不再从全量资料或旧表补 hidden/组外值。旧入口
check_consistency(resume, ProfileOut, selected_data) 保留给既有单元测试，行为不变
（两参分派，见下）。
"""

from __future__ import annotations

import json
import re

from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from ..profile.profile_context import build_profile_prompt_data
from .resume_grounding import (
    _find_source,
    _similar,
    _similar_skill,
    _source_evidence_text,
    _unsupported_quantified_values,
)


def _skill_visible_in_candidates(skill_name: str, source_data: dict) -> bool:
    """技能名是否出现在候选资料的**任何文本**里（skills 名单之外的兜底豁免）。

    技能名常带括号补全说明（「Excel（VLOOKUP、数据透视表）」），候选正文里出现的
    往往只有主名，所以比对取括号前的主体，大小写无关做包含判断。主名过短
    （如单字母「R」）时子串会到处命中，退回整词匹配——宁可保留"请核对"，
    也不把核对门槛放宽到形同虚设。
    """
    main = re.split(r"[（(]", skill_name.strip(), maxsplit=1)[0].strip()
    if not main:
        return False
    text = json.dumps(source_data, ensure_ascii=False).casefold()
    needle = main.casefold()
    if len(needle) < 2:
        return False
    if len(needle) == 2 and needle.isascii():
        # 两个 ASCII 字符（如 "Go"）的子串太容易撞上无关单词，要求整词出现。
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", text))
    return needle in text


def _items(source_data: dict, key: str) -> list[dict]:
    """候选分区列表；未参与分区整键不出现（R-29/R-30）→ 返回空列表，不 KeyError。"""
    value = source_data.get(key)
    return value if isinstance(value, list) else []


def _known_names(source_data: dict, key: str, field: str) -> list[str]:
    return [item[field] for item in _items(source_data, key) if item.get(field)]


def _custom_field_evidence(profile: ConsumedProfile) -> list[str]:
    """R1-F：消费快照里的自定义字段值（含自建分区）也必须算“资料提供过”。

    量化核对只拿内置字段的候选数据当合法来源，会把用户在自定义字段里写的数字
    （例如「团队协作说明」里的「从 3 天压到 1 天」）误报成虚构。
    """
    values: list[str] = []
    for section in profile.sections.values():
        specs = [spec for spec in section.fields if not spec.is_builtin and not spec.private]
        if not specs:
            continue
        for entry in section.entries:
            for spec in specs:
                value = str(entry.values.get(spec.field_id) or "").strip()
                if value:
                    values.append(value)
    return values


def _check_source_data(
    resume: ResumeContent,
    source_data: dict,
    label: str,
    *,
    extra_evidence: list[str] | None = None,
) -> list[str]:
    """一致性检查的唯一实现：只依赖候选数据（本次实际发给模型的那份）。

    未参与分区整键不出现，因此所有分区都必须按 .get(key) or [] 访问
    （R-29/R-30：七项组不能因为 skills 不在候选里就抛 KeyError）。
    """
    warnings: list[str] = []
    # 自定义字段值作为补充证据：量化核对时与内置候选同等对待（R1-F）。
    evidence_suffix = "\n" + "\n".join(extra_evidence) if extra_evidence else ""
    known_schools = _known_names(source_data, "educations", "school")
    known_companies = _known_names(source_data, "experiences", "company")
    known_campus_organizations = _known_names(
        source_data, "campus_experiences", "organization"
    )
    known_projects = _known_names(source_data, "projects", "name")
    known_skills = _known_names(source_data, "skills", "name")
    known_awards = _known_names(source_data, "awards", "name")

    for edu in resume.education:
        if edu.school and not any(_similar(edu.school, s) for s in known_schools):
            warnings.append(
                f"教育经历中出现{label}未包含的学校「{edu.school}」，请核对是否为虚构"
            )
    for exp in resume.experience:
        if exp.company and not any(_similar(exp.company, c) for c in known_companies):
            warnings.append(
                f"实习/工作经历中出现{label}未包含的公司「{exp.company}」，请核对是否为虚构"
            )
        source = _find_source(exp, _items(source_data, "experiences"), "company", "role")
        if source:
            unsupported = _unsupported_quantified_values(
                exp.description,
                _source_evidence_text(source, ("description",)) + evidence_suffix,
            )
            if unsupported:
                warnings.append(
                    f"实习/工作经历「{exp.company}」出现资料未提供的量化结果「{'、'.join(unsupported)}」"
                )
    for item in resume.campus_experience:
        if item.organization and not any(
            _similar(item.organization, organization)
            for organization in known_campus_organizations
        ):
            warnings.append(
                f"校园经历中出现{label}未包含的组织「{item.organization}」，请核对是否为虚构"
            )
        source = _find_source(
            item, _items(source_data, "campus_experiences"), "organization", "role"
        )
        if source:
            unsupported = _unsupported_quantified_values(
                item.description,
                _source_evidence_text(source, ("description",)) + evidence_suffix,
            )
            if unsupported:
                warnings.append(
                    f"校园经历「{item.organization}」出现资料未提供的量化结果「{'、'.join(unsupported)}」"
                )
    for project in resume.projects:
        if project.name and not any(_similar(project.name, p) for p in known_projects):
            warnings.append(
                f"项目经历中出现{label}未包含的项目「{project.name}」，请核对是否为虚构"
            )
        source = _find_source(project, _items(source_data, "projects"), "name", "role")
        if source:
            source_text = _source_evidence_text(source, ("description", "highlights"))
            unsupported = _unsupported_quantified_values(
                project.description + project.highlights, source_text + evidence_suffix
            )
            if unsupported:
                warnings.append(
                    f"项目经历「{project.name}」出现资料未提供的量化结果「{'、'.join(unsupported)}」"
                )
    for skill in resume.skills:
        if skill.name and not any(_similar_skill(skill.name, known) for known in known_skills):
            if _skill_visible_in_candidates(skill.name, source_data):
                # 技能没进 skills 候选名单，但出现在候选资料的正文里（项目描述、
                # tech_stack 等）——那是模型从条目内容里提炼的，不是虚构。
                # 只比技能名单会让这类技能全部被冤枉成"疑似虚构"。
                continue
            warnings.append(
                f"专业技能中出现{label}未包含的技能「{skill.name}」，请核对是否为虚构"
            )
    for award in resume.awards:
        if award.name and not any(_similar(award.name, known) for known in known_awards):
            warnings.append(
                f"荣誉奖项中出现{label}未包含的奖项「{award.name}」，请核对是否为虚构"
            )
    # ===== A4 扩展栏目（学术成果/科研项目/知识产权/证书资质）=====
    # 只有候选资料**确实带了这个键**时才比对：旧链路（个人资料 prompt data）没有这些键，
    # 若无条件比对，所有带科研/证照的旧简历都会被冤枉成"虚构"。键存在 = 本次确实给了模型。
    extended_sections = (
        ("publications", "title", "学术成果", resume.publications),
        ("research_projects", "name", "科研项目", resume.research_projects),
        ("patents", "title", "知识产权", resume.patents),
        ("credentials", "name", "证书资质", resume.credentials),
    )
    for source_key, identity_field, section_label, entries in extended_sections:
        candidates = source_data.get(source_key)
        if not isinstance(candidates, list) or not candidates:
            continue
        known = [
            str(candidate.get(identity_field) or "").strip()
            for candidate in candidates
            if isinstance(candidate, dict)
        ]
        for entry in entries:
            value = str(getattr(entry, identity_field, "") or "").strip()
            if value and not any(_similar(value, known_value) for known_value in known):
                warnings.append(
                    f"{section_label}中出现{label}未包含的「{value}」，请核对是否为虚构"
                )
    unsupported_summary = _unsupported_quantified_values(
        resume.summary, json.dumps(source_data, ensure_ascii=False) + evidence_suffix
    )
    if unsupported_summary:
        warnings.append(
            f"个人总结出现资料未提供的量化结果「{'、'.join(unsupported_summary)}」"
        )
    return warnings


def check_consistency(
    resume: ResumeContent,
    profile: ProfileOut | ConsumedProfile,
    selected_data: dict | None = None,
    *,
    source_label: str | None = None,
) -> list[str]:
    """校验生成结果是否出现候选资料中不存在的信息（防 AI 虚构）。

    第二参是 ConsumedProfile 时走 F3 新路径：候选数据取 selection_data["data"]
    （已按当前组过滤），不读全量资料；source_label 用于替换"资料来源"的说法
    （通用简历没有岗位，说"本岗位候选资料"会让用户误会）。
    第二参是 ProfileOut/dict 时保持旧行为（既有单元测试）。
    """
    if isinstance(profile, ConsumedProfile):
        candidate = selected_data.get("data") if isinstance(selected_data, dict) else None
        source_data = candidate if isinstance(candidate, dict) else {}
        label = source_label or "本岗位候选资料"
        return _check_source_data(
            resume, source_data, label, extra_evidence=_custom_field_evidence(profile)
        )
    source_data = selected_data or build_profile_prompt_data(profile)
    label = source_label or ("本岗位候选资料" if selected_data is not None else "个人资料")
    return _check_source_data(resume, source_data, label)


__all__ = ["check_consistency"]
