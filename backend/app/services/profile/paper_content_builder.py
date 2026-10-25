# SPDX-License-Identifier: Apache-2.0
"""纸面内容组装（paper_projection 的内部实现）：消费快照 → ResumeContent + 警告。

拆出本模块的唯一原因是仓库的单文件硬上限（paper_projection.py 需要同时暴露公共
API、C5-B 与承载区纯函数）；两者是同一实现的表与里：**所有映射表在 paper_policy**、
**限长/照片在 paper_limits**，这里只做遍历、拆分、组装。公共入口统一从
paper_projection 导入。

组装规则（R-42/R-79）：
- 13 个系统分区按 participating_keys（= 全局顺序）逐条映射到 ResumeContent；
- basic_info 只投影身份标量槽位（其余字段只进生成素材，R-43）；
- summary 写 ResumeContent.summary（单例）；
- languages 在系统技能之后整条追加为 skills 条目（R-72）；
- 自建分区（custom: 前缀）进 content.custom_sections（13 个系统分区之后）；
- 承载区追加行按字段定义顺序，超长时保留默认正文、其余进 warnings（R-44）。

**私密字段**：ConsumedFieldSpec.private（证书编号）在遍历时直接跳过，永不进
content / candidates / warnings 的文本。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ...schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
    ProjectionWarningOut,
)
from ...schemas.resume import ResumeContent
from ...schemas.resume_custom_sections import (
    ResumeCustomEntry,
    ResumeCustomLine,
    ResumeCustomSection,
)
from ...schemas.resume_research import MAX_AUTHORS, ResumeAuthor
from . import paper_policy
from .language_projection import (
    LANGUAGE_LEVEL_MAX,
    language_overflow_warnings,
    project_language_skill_entries,
)
from .paper_limits import (
    PhotoResolver,
    clip_text,
    fit_lines,
    fit_scalar,
    has_value,
    resolve_photo,
    slot_limit,
    split_items,
    split_lines,
    warn,
    warn_slot_clip,
)

MAX_CUSTOM_ENTRY_TEXT, MAX_CUSTOM_LINE_VALUE = 4_000, 2_000
MAX_CUSTOM_LINE_LABEL, MAX_CUSTOM_LINES = 64, 30
MAX_CUSTOM_SECTION_TITLE, MAX_CUSTOM_SECTION_KEY = 40, 64


@dataclass(frozen=True)
class ContentAssembly:
    """组装结果：内容 + 每条候选在 content 里的位置（paper_content_path）。

    entry_paths 只登记**真的产生了纸面内容**的条目（空条目被跳过、没有位置）；
    候选层用它回答"这条资料对应 content 的哪一项"，不按标题猜、不再算第二遍。
    """

    content: ResumeContent
    entry_paths: dict[str, str]


__all__ = [
    "ContentAssembly",
    "clean_values",
    "first_line",
    "is_http_url",
    "project_content",
]


def project_content(
    consumed: ConsumedProfile,
    resolve_photo_hook: PhotoResolver | None,
    warnings: list[ProjectionWarningOut],
) -> ContentAssembly:
    """把消费快照组装成 ResumeContent；警告写进调用方传入的列表（保序）。"""
    content = ResumeContent()
    entry_paths: dict[str, str] = {}
    custom_sections: list[ResumeCustomSection] = []
    for key in consumed.participating_keys:
        section = consumed.sections.get(key)
        if section is None:
            continue
        if key == "basic_info":
            _apply_header(content, section, resolve_photo_hook, warnings, entry_paths)
        elif key == "summary":
            _apply_summary(content, section, warnings, entry_paths)
        elif key == "languages":
            continue  # 语言排在系统技能之后，主循环结束后统一追加（R-72）
        elif key.startswith("custom:"):
            projected = _project_custom_section(section, entry_paths)
            if projected is not None:
                custom_sections.append(projected)
        else:
            rule = paper_policy.SECTION_RULES.get(key)
            if rule is not None:
                _apply_section_entries(content, section, rule, warnings, entry_paths)
    content.custom_sections = custom_sections
    languages = consumed.sections.get("languages")
    if languages is not None and "languages" in consumed.participating_keys:
        base_index = len(content.skills)
        for offset, (entry_id, skill) in enumerate(project_language_skill_entries(languages)):
            content.skills.append(skill)
            entry_paths[entry_id] = f"skills/{base_index + offset}"
        for entry_id, language, length in language_overflow_warnings(languages):
            warn(
                warnings,
                "carrier_overflow",
                "languages",
                entry_id,
                f"语言「{language}」的纸面标签有 {length} 个字符，超过 {LANGUAGE_LEVEL_MAX} "
                "字符上限，已截断；请缩短水平/证书/分数后重新填充",
            )
    return ContentAssembly(content=content, entry_paths=entry_paths)


def clean_values(values: Mapping[str, object]) -> dict[str, str]:
    """只保留有值的字段（去首尾空白）；None/空白等价于"没有提交"。"""
    cleaned: dict[str, str] = {}
    for raw_key, raw_value in dict(values or {}).items():
        text = "" if raw_value is None else str(raw_value).strip()
        if text:
            cleaned[str(raw_key)] = text
    return cleaned


def first_line(text: str) -> str:
    lines = split_lines(text)
    return lines[0] if lines else ""


def is_http_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def _apply_header(
    content: ResumeContent,
    section: ConsumedSection,
    resolve_photo_hook: PhotoResolver | None,
    warnings: list[ProjectionWarningOut],
    entry_paths: dict[str, str],
) -> None:
    """基本信息 → ResumeContent 的身份标量槽位（其余字段只进生成素材，R-43）。

    basic_info / summary 是单例标量，没有"可追加的一条数组项"：basic_info 的候选
    不填 paper_content_path，summary 的候选填 "summary"。
    """
    if not section.entries:
        return
    entry = section.entries[0]
    entry_paths[entry.entry_id] = ""
    values = clean_values(entry.values)
    clipped: list[str] = []
    for spec in section.fields:
        slot = paper_policy.BASIC_INFO_SLOTS.get(spec.key) if spec.is_builtin else None
        value = values.get(spec.field_id, "")
        if slot is None or not value:
            continue
        if slot.kind == "photo":
            resolved = resolve_photo(
                value, resolve_photo_hook, section.key, entry.entry_id, warnings
            )
            if resolved:
                content.photo = resolved
            continue
        fitted, cut = clip_text(value, slot_limit(ResumeContent, slot.attr))
        setattr(content, slot.attr, fitted)
        if cut:
            clipped.append(spec.label)
    warn_slot_clip(warnings, section.key, entry.entry_id, clipped)


def _apply_summary(
    content: ResumeContent,
    section: ConsumedSection,
    warnings: list[ProjectionWarningOut],
    entry_paths: dict[str, str],
) -> None:
    """单例「个人总结」：正文 + 自定义字段标签行，追加到结尾（R-42 映射表）."""
    if not section.entries:
        return
    entry = section.entries[0]
    entry_paths[entry.entry_id] = "summary"
    values = clean_values(entry.values)
    carrier = paper_policy.carrier_field_id("summary") or "summary.content"
    base = values.get(carrier, "")
    extras = [
        (spec.label, f"{spec.label}：{values[spec.field_id]}")
        for spec in section.fields
        if spec.field_id != carrier and not spec.private and values.get(spec.field_id)
    ]
    limit = slot_limit(ResumeContent, "summary") or 0
    content.summary = fit_scalar(base, extras, limit, (section.key, entry.entry_id), warnings)


def _apply_section_entries(
    content: ResumeContent,
    section: ConsumedSection,
    rule: paper_policy.PaperSectionRule,
    warnings: list[ProjectionWarningOut],
    entry_paths: dict[str, str],
) -> None:
    target = getattr(content, rule.resume_field)
    for entry in section.entries:
        item = _build_entry(section, entry, rule, warnings)
        if item is not None:
            entry_paths[entry.entry_id] = f"{rule.resume_field}/{len(target)}"
            target.append(item)


def _build_entry(
    section: ConsumedSection,
    entry: ConsumedEntry,
    rule: paper_policy.PaperSectionRule,
    warnings: list[ProjectionWarningOut],
) -> object | None:
    values = clean_values(entry.values)
    slot_values: dict[str, object] = {}
    extras: list[tuple[str, str]] = []
    base = ""
    clipped: list[str] = []
    carrier_id = paper_policy.carrier_field_id(section.key)
    for spec in section.fields:
        value = values.get(spec.field_id, "")
        if spec.field_id == carrier_id:
            base = value
            continue
        if not value or spec.private:
            continue
        slot = rule.slots.get(spec.key) if spec.is_builtin else None
        if slot is None:
            extras.append((spec.label, f"{spec.label}：{value}"))
            continue
        _apply_slot(slot_values, extras, clipped, spec, value, slot, rule.model)
    carrier_value: object = None
    if rule.carrier_attr is not None:
        if rule.carrier_list:
            carrier_value = fit_lines(
                base, extras, rule.model, rule.carrier_attr, section.key, entry.entry_id, warnings
            )
        else:
            limit = slot_limit(rule.model, rule.carrier_attr) or 0
            carrier_value = fit_scalar(base, extras, limit, (section.key, entry.entry_id), warnings)
    warn_slot_clip(warnings, section.key, entry.entry_id, clipped)
    # 空条目不产生纸面占位（"只映射有值内容"）：所有槽位与承载区都要看。
    if not has_value(carrier_value) and not any(has_value(value) for value in slot_values.values()):
        return None
    if rule.carrier_attr is not None:
        slot_values[rule.carrier_attr] = carrier_value
    return rule.model(**slot_values)


def _apply_slot(
    slot_values: dict[str, object],
    extras: list[tuple[str, str]],
    clipped: list[str],
    spec: ConsumedFieldSpec,
    value: str,
    slot: paper_policy.SlotRule,
    model: type,
) -> None:
    """把一个默认字段落到槽位；枚举/URL 不认识时退回承载区追加（不擅改、不丢值）。"""
    if slot.kind == "enum":
        mapped = (slot.enum or {}).get(value)
        if mapped is None:
            extras.append((spec.label, f"{spec.label}：{value}"))
        else:
            slot_values[slot.attr] = mapped
        return
    if slot.kind == "url":
        if not is_http_url(value):
            extras.append((spec.label, f"{spec.label}：{value}"))
            return
        fitted, cut = clip_text(value, slot_limit(model, slot.attr))
        slot_values[slot.attr] = fitted
        if cut:
            clipped.append(spec.label)
        return
    if slot.kind in ("lines", "items"):
        names = split_lines(value) if slot.kind == "lines" else split_items(value)
        limit = slot_limit(model, slot.attr)
        if limit is not None and len(names) > limit:
            names = names[:limit]
            clipped.append(spec.label)
        slot_values[slot.attr] = names
        return
    if slot.kind == "authors":
        names = split_items(value)
        if len(names) > MAX_AUTHORS:
            names = names[:MAX_AUTHORS]
            clipped.append(spec.label)
        slot_values[slot.attr] = [ResumeAuthor(name=name[:128]) for name in names]
        return
    fitted, cut = clip_text(value, slot_limit(model, slot.attr))
    slot_values[slot.attr] = fitted
    if cut:
        clipped.append(spec.label)


def _project_custom_section(
    section: ConsumedSection, entry_paths: dict[str, str]
) -> ResumeCustomSection | None:
    """自建大字段 → 独立纸面分区（C2/R-79）：主文本 + 其余字段的标签行。"""
    text_field_id = paper_policy.custom_section_text_field(section)
    line_fields = paper_policy.custom_section_line_fields(section, text_field_id)
    entries: list[ResumeCustomEntry] = []
    for entry in section.entries:
        values = clean_values(entry.values)
        text = values.get(text_field_id, "") if text_field_id else ""
        text = text[:MAX_CUSTOM_ENTRY_TEXT]
        lines: list[ResumeCustomLine] = []
        for spec in line_fields:
            value = values.get(spec.field_id, "")[:MAX_CUSTOM_LINE_VALUE]
            label = spec.label[:MAX_CUSTOM_LINE_LABEL]
            if not value or not label:
                continue
            lines.append(ResumeCustomLine(label=label, value=value))
        if not text and not lines:
            continue  # 空条目不产生占位（同系统分区）
        entry_paths[entry.entry_id] = f"custom_sections/{section.key}/entries/{len(entries)}"
        entries.append(
            ResumeCustomEntry(
                entry_id=entry.entry_id[:32], text=text, lines=lines[:MAX_CUSTOM_LINES]
            )
        )
    if not entries:
        return None
    title = section.name.strip()[:MAX_CUSTOM_SECTION_TITLE]
    if not title:
        return None
    return ResumeCustomSection(
        key=section.key[:MAX_CUSTOM_SECTION_KEY], title=title, entries=entries
    )
