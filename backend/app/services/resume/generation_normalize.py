# SPDX-License-Identifier: Apache-2.0
"""生成内容的文本归一化与按 key 合并（从 generation_postprocess 拆出，单文件预算）。

职责两类，都是**确定性纯函数**（不调模型、不改库）：
1. 归一化（R1-A/R1-B）：剥行首 markdown 列表前缀；同一条目正文行保序去重；
   projects 的 description/highlights、research_projects 的 description/outcomes 跨槽位
   重复只保留首次出现（资料里两条经常是同一批句子）。
2. 按 key 合并（R1-G）：按条目身份匹配回消费快照，把资料有、模型写空的字段（tech_stack
   等列表值、技能 level、日期）合并回来；缺失技能只补进入本次候选名单的，不绕过岗位筛选。

生成链路在 grounding/回填之后调用；填充链路不受影响。
"""

from __future__ import annotations

import logging
import re
from typing import Any

from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from ...schemas.resume_custom_sections import ResumeCustomEntry, ResumeCustomSection
from ..profile.paper_policy import is_material_only
from ..profile.paper_projection import normalize_for_match, project_paper_content
from .resume_grounding_helpers import _similar, _similar_skill

logger = logging.getLogger(__name__)

#: 条目的身份/可见性/锁字段：按 key 合并时一律不动。
_NON_CONTENT_ATTRS = frozenset(
    {"id", "point_ids", "hidden", "hidden_points", "lock_content", "lock_layout"}
)

#: 行首 markdown 列表前缀：资料/模型里常见 "- xxx"、"* xxx"、"• xxx"、"1. xxx"；
#: 纸面已按“每条一行 + 项目符号”渲染，再保留前缀会变成「· - xxx」双符号。
_MARKDOWN_PREFIXES = (
    re.compile(r"^\s*[-*+•·—]\s+"),
    re.compile(r"^\s*\d{1,3}\s*[.、)]\s*"),
)

#: 各条目里的“正文行列表”字段（v1 结构）。
_LINE_FIELDS: dict[str, tuple[str, ...]] = {
    "education": ("courses", "achievements"),
    "experience": ("description",),
    "campus_experience": ("description",),
    "projects": ("tech_stack", "description", "highlights"),
    "research_projects": ("description", "outcomes"),
}
#: 同一 v1 条目里内容可能重叠的 text 槽位（资料里两条经常是同一批句子）。
_MERGED_TEXT_FIELDS: dict[str, tuple[str, str]] = {
    "projects": ("description", "highlights"),
    "research_projects": ("description", "outcomes"),
}


def strip_markdown_prefix(value: Any) -> str:
    """剥掉行首 markdown 列表标记（- * + • · — 与 1. 1、1)），保留其余文本。"""
    text = str(value or "")
    for pattern in _MARKDOWN_PREFIXES:
        stripped = pattern.sub("", text, count=1)
        if stripped != text:
            return stripped.strip()
    return text.strip()


def _dedupe_lines(values: list[Any]) -> list[str]:
    """保序去重（normalize_for_match 归一化后比较，保留首次出现的原文）。"""
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = normalize_for_match(text)
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        deduped.append(text)
    return deduped


def normalize_generated_content(resume: ResumeContent) -> ResumeContent:
    """生成内容的确定性归一化（R1-A/R1-B）。

    - 正文行行首 markdown 列表标记统一剥掉（来源可能是资料行本身或模型自己写）；
    - projects / research_projects 的 description 与 highlights/outcomes 在资料里可能
      高度重叠：同一句被两个槽位写进正文会在纸面上重复，这里按规范化文本保序去重；
    - summary / 自建分区文本同样逐行剥前缀。
    """
    updates: dict[str, Any] = {}
    for field, attrs in _LINE_FIELDS.items():
        items = list(getattr(resume, field, None) or [])
        changed = False
        for index, item in enumerate(items):
            patch: dict[str, Any] = {}
            for attr in attrs:
                original = list(getattr(item, attr, None) or [])
                cleaned = _dedupe_lines([strip_markdown_prefix(value) for value in original])
                if cleaned != original:
                    patch[attr] = cleaned
            merge = _MERGED_TEXT_FIELDS.get(field)
            if merge is not None:
                first, second = merge
                first_values = list(patch.get(first, getattr(item, first, None) or []))
                second_values = list(patch.get(second, getattr(item, second, None) or []))
                combined = first_values + second_values
                deduped = _dedupe_lines(combined)
                if len(deduped) != len(combined):
                    patch[first] = deduped
                    patch[second] = []
            if patch:
                items[index] = item.model_copy(update=patch)
                changed = True
        if changed:
            updates[field] = items
    summary = str(resume.summary or "")
    if summary:
        cleaned_summary = "\n".join(
            strip_markdown_prefix(line) for line in summary.splitlines() if line.strip()
        )
        if cleaned_summary != summary:
            updates["summary"] = cleaned_summary
    if resume.custom_sections:
        sections: list[ResumeCustomSection] = []
        custom_changed = False
        for section in resume.custom_sections:
            entries: list[ResumeCustomEntry] = []
            for entry in section.entries:
                text = "\n".join(
                    strip_markdown_prefix(line)
                    for line in str(entry.text or "").splitlines()
                    if line.strip()
                )
                lines = [
                    line.model_copy(update={"value": strip_markdown_prefix(line.value)})
                    for line in entry.lines
                ]
                if text != entry.text or any(
                    new.value != old.value for new, old in zip(lines, entry.lines, strict=True)
                ):
                    custom_changed = True
                entries.append(entry.model_copy(update={"text": text, "lines": lines}))
            sections.append(section.model_copy(update={"entries": entries}))
        if custom_changed:
            updates["custom_sections"] = sections
    return resume.model_copy(update=updates) if updates else resume


def _is_blank_value(value: Any) -> bool:
    if isinstance(value, list):
        return not value
    return not str(value or "").strip()


def _find_fallback_item(
    fallback_items: list[Any], item: Any, section_key: str, identity_attr: str
) -> Any | None:
    matcher = _similar_skill if section_key == "skills" else _similar
    target = str(getattr(item, identity_attr, "") or "").strip()
    if not target:
        return None
    for candidate in fallback_items:
        source = str(getattr(candidate, identity_attr, "") or "").strip()
        if source and matcher(target, source):
            return candidate
    return None


def _selected_skill_names(selection_data: dict[str, Any] | None) -> set[str] | None:
    if not isinstance(selection_data, dict):
        return None
    candidates = selection_data.get("data")
    if not isinstance(candidates, dict):
        return None
    names: set[str] = set()
    for skill in candidates.get("skills") or []:
        if isinstance(skill, dict):
            name = str(skill.get("name") or "").strip()
            if name:
                names.add(name)
    return names


def merge_missing_consumed_fields(
    resume: ResumeContent, consumed: ConsumedProfile, selection_data: dict[str, Any] | None = None
) -> ResumeContent:
    """R1-G：按条目身份匹配后，把资料里有、模型写空的字段按 key 合并回来。

    只改**已存在条目**的空白字段（不凭空造条目）；列表值（tech_stack 等）、技能水平、
    日期等都会补。缺失技能条目仅在“进入本次候选数据”时补回（不绕过岗位筛选）。
    """
    # 延迟导入避免与 generation_postprocess 循环（该模块 re-export 本模块的公开函数）。
    from .generation_postprocess import _CARRIER_SECTIONS

    fallback = project_paper_content(consumed)
    updates: dict[str, Any] = {}
    for (
        section_key,
        resume_field,
        identity_attr,
        _identity_field_id,
        carrier,
        is_list,
    ) in _CARRIER_SECTIONS:
        if is_material_only(section_key):
            continue
        section = consumed.section(section_key)
        items = list(getattr(resume, resume_field, None) or [])
        fallback_items = list(getattr(fallback, resume_field, None) or [])
        if section is None or not items or not fallback_items:
            continue
        changed = False
        for index, item in enumerate(items):
            source_item = _find_fallback_item(fallback_items, item, section_key, identity_attr)
            if source_item is None:
                continue
            patch: dict[str, Any] = {}
            for attr in type(item).model_fields:
                if attr in _NON_CONTENT_ATTRS:
                    continue
                if attr == carrier and is_list:
                    continue
                if _is_blank_value(getattr(item, attr)) and not _is_blank_value(
                    getattr(source_item, attr)
                ):
                    patch[attr] = getattr(source_item, attr)
            if patch:
                items[index] = item.model_copy(update=patch)
                changed = True
        if changed:
            updates[resume_field] = items
    selected = _selected_skill_names(selection_data)
    fallback_skills = list(getattr(fallback, "skills", None) or [])
    if fallback_skills:
        existing = list(updates.get("skills", resume.skills))
        existing_names = [str(skill.name or "") for skill in existing]
        appended = False
        for skill in fallback_skills:
            name = str(skill.name or "").strip()
            if not name or (selected is not None and name not in selected):
                continue
            if any(_similar_skill(name, current) for current in existing_names if current):
                continue
            existing.append(skill)
            existing_names.append(name)
            appended = True
        if appended:
            updates["skills"] = existing
    if updates:
        logger.info("生成字段合并完成：分区数=%s", len(updates))
        return resume.model_copy(update=updates)
    return resume
