# SPDX-License-Identifier: Apache-2.0
"""v1 ResumeContent -> v2 ResumeDocument 转换器与读时版本收口（D11/D12）。

**调用面只有一个**：所有读取简历 content 的入口（详情/render/export/AI/bilingual/history）
统一走 ensure_document_version(content)：v2 直接校验/归一化，v1 走 convert_content 转换
（不写库）；保存时写 v2。幂等：v2 再转不变。

**文字不丢**的保证：convert_content 只做"识别为 item"或"保留为文本块"两种处理；
无法识别的内容一律 TextItem，并在 ConversionReport 里记明细（多少字段识别、多少行保留、
哪些分区为空、哪些警告）。

已存文档的分析直接读取 v2 节点。本模块不 import API/DB/渲染，纯函数可单测。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ...schemas.resume import ResumeContent
from ...schemas.resume_document import (
    ResumeDocument,
    ResumeEntry,
    ResumeHeader,
    ResumeSection,
    TextItem,
    document_to_json,
    normalize_document,
    parse_document,
)
from ...schemas.resume_entries import MAX_RESUME_LIST_ITEMS
from . import document_catalog as catalog
from .document_conversion_types import (
    ConversionError,
    ConversionReport,
    CustomFieldHint,
    stable_object_id,
)
from .document_converter_custom import (
    build_custom_section_items,
    build_header_items,
    summary_items,
)
from .document_converter_sections import build_entry_items, hints_by_doc_section
from .resume_contact import validate_contact_breaks
from .resume_labels import normalize_language
from .resume_sections import normalized_section_order

__all__ = [
    "ConversionError",
    "ConversionReport",
    "CustomFieldHint",
    "convert_content",
    "ensure_document_version",
    "ensure_document_version_with_report",
]

#: v2 分区 key -> v1 ResumeContent 的列表属性名。
_V1_LIST_ATTRS: dict[str, str] = {
    "education": "education",
    "experience": "experience",
    "projects": "projects",
    "campus_experience": "campus_experience",
    "awards": "awards",
    "publications": "publications",
    "research_projects": "research_projects",
    "patents": "patents",
    "credentials": "credentials",
    "skills": "skills",
    "languages": "languages",
}

_VALID_V2_PLACEMENTS = frozenset(("lead", "trail"))

# v1 format_config.field_layout 里可调"补充字段排版"的七个分区（与 resume_content 的七个
# 承载补充字段的分区一致）。这是**迁移输入**的契约，只在本转换器使用；v1 的排版实现
# （resume_field_layout*.py / profile_field_lines.py）已删除，渲染器只认 v2 plan。
FIELD_LAYOUT_SECTIONS: tuple[str, ...] = (
    "education",
    "experience",
    "campus_experience",
    "projects",
    "awards",
    "publications",
    "research_projects",
)


def ensure_document_version_with_report(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> tuple[dict, ConversionReport | None]:
    """把任意版本的 content 收口成 v2 dict；返回 (document dict, 转换报告或 None)。

    报告为 None 表示本来就是 v2（没有发生转换）——API 用它决定要不要提示"已升级"。
    """
    if isinstance(content, ResumeDocument):
        return document_to_json(normalize_document(content)), None
    if not isinstance(content, dict):
        raise ConversionError("简历内容必须是对象")
    if content.get("version") == 2:
        return document_to_json(parse_document(content)), None
    document, report = convert_content(
        content,
        language=language or "zh-CN",
        format_config=format_config,
        custom_fields=custom_fields,
    )
    return document_to_json(document), report


def ensure_document_version(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> dict:
    """v2 直通 / v1 转换后的 v2 dict（幂等；读路径统一入口）。"""
    return ensure_document_version_with_report(
        content, language=language, format_config=format_config, custom_fields=custom_fields
    )[0]


def convert_content(
    content: Any,
    *,
    language: str = "zh-CN",
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> tuple[ResumeDocument, ConversionReport]:
    """把 v1 ResumeContent（模型或 dict）转成 v2 文档 + 报告；结构非法抛 ConversionError。"""
    legacy = _coerce_legacy(content)
    report = ConversionReport()
    hints = hints_by_doc_section(custom_fields)
    config = dict(format_config) if isinstance(format_config, Mapping) else {}
    header = ResumeHeader(
        items=build_header_items(legacy, report),
        contact_breaks=validate_contact_breaks(config.get("contact_breaks")),
    )
    sections = _convert_sections(legacy, hints, report)
    _apply_field_layout(sections, config)
    ordered = _ordered_sections(sections, config)
    document = ResumeDocument(
        language=normalize_language(language),
        header=header,
        sections=ordered,
    )
    return normalize_document(document), report


def _coerce_legacy(content: Any) -> ResumeContent:
    if isinstance(content, ResumeContent):
        return content
    if not isinstance(content, Mapping):
        raise ConversionError("简历内容必须是对象")
    if content.get("version") == 2:
        raise ConversionError("已经是 v2 文档，不需要转换")
    try:
        return ResumeContent.model_validate(dict(content))
    except Exception as exc:  # pydantic ValidationError 消息对用户可读
        raise ConversionError("旧版简历内容结构不合法：" + str(exc)) from exc


def _convert_sections(
    legacy: ResumeContent,
    hints: Mapping[str, Sequence[CustomFieldHint]],
    report: ConversionReport,
) -> list[ResumeSection]:
    sections: list[ResumeSection] = []
    for spec in catalog.SECTION_ORDER:
        section = _convert_system_section(spec, legacy, hints, report)
        if section is not None:
            sections.append(section)
    sections.extend(_convert_custom_sections(legacy, hints, report))
    return sections


def _cap_items(items: list[Any], report: ConversionReport, section_key: str) -> list[Any]:
    """单条目 item 数超限时的兜底（计划 §3.4：截断 + warning，文字不丢）。

    v2 schema 的 ResumeEntry.items 有上限；旧数据（例如承载区被塞进 501 行）如果原样
    转成 item 会让整份文档校验失败。策略：超出部分若都是 TextItem，**合并成一个正文块**
    （文字一个不丢，只是不再逐行分条）；混合类型无法合并时截断并如实记 warning。
    """
    if len(items) <= MAX_RESUME_LIST_ITEMS:
        return items
    keep = list(items[: MAX_RESUME_LIST_ITEMS - 1])
    overflow = list(items[MAX_RESUME_LIST_ITEMS - 1 :])
    texts = [item for item in overflow if isinstance(item, TextItem)]
    other = [item for item in overflow if not isinstance(item, TextItem)]
    if texts and not other:
        merged_style = getattr(texts[0], "style", "bullet")
        keep.append(
            TextItem(
                style=merged_style,
                text="\n".join(str(item.text or "") for item in texts),
            )
        )
        report.warn(
            f"分区「{section_key}」的单条内容超过 {MAX_RESUME_LIST_ITEMS} 条："
            "超出部分已合并为一个正文块（文字保留，不再逐行分条）"
        )
        return keep
    report.warn(
        f"分区「{section_key}」的单条内容超过 {MAX_RESUME_LIST_ITEMS} 条："
        f"已截断保留前 {MAX_RESUME_LIST_ITEMS} 条（含非文本字段，无法安全合并），请精简后重新保存"
    )
    return keep[:MAX_RESUME_LIST_ITEMS]


def _convert_system_section(
    spec: Any,
    legacy: ResumeContent,
    hints: Mapping[str, Sequence[CustomFieldHint]],
    report: ConversionReport,
) -> ResumeSection | None:
    if spec.kind == "text":
        items = _cap_items(summary_items(getattr(legacy, "summary", ""), report), report, spec.key)
        if not items:
            return None
        entry = ResumeEntry(id=stable_object_id("ob_", spec.key, "entry"), items=items)
        return ResumeSection(key=spec.key, title="", kind="text", entries=[entry])
    entries: list[ResumeEntry] = []
    attr = _V1_LIST_ATTRS.get(spec.key)
    source_entries = list(getattr(legacy, attr, []) or []) if attr else []
    for index, legacy_entry in enumerate(source_entries):
        stable_entry_id = _entry_id(legacy_entry)
        scope = stable_entry_id or ("idx" + str(index))
        items = _cap_items(
            build_entry_items(spec.key, legacy_entry, report, hints, scope=scope),
            report,
            spec.key,
        )
        if not items:
            continue
        entries.append(
            ResumeEntry(
                id=stable_entry_id or stable_object_id("ob_", spec.key, scope),
                hidden=bool(getattr(legacy_entry, "hidden", False)),
                lock_content=bool(getattr(legacy_entry, "lock_content", False)),
                lock_layout=bool(getattr(legacy_entry, "lock_layout", False)),
                items=items,
            )
        )
    if not entries:
        if source_entries:
            report.empty_sections.append(spec.key)
            report.warn(
                "分区「"
                + spec.key
                + "」有 "
                + str(len(source_entries))
                + " 条旧数据但未产生纸面内容"
            )
        return None
    return ResumeSection(key=spec.key, title="", kind=spec.kind, entries=entries)


def _convert_custom_sections(
    legacy: ResumeContent,
    hints: Mapping[str, Sequence[CustomFieldHint]],
    report: ConversionReport,
) -> list[ResumeSection]:
    sections: list[ResumeSection] = []
    for legacy_section in getattr(legacy, "custom_sections", []) or []:
        key = str(getattr(legacy_section, "key", "") or "").strip()
        title = str(getattr(legacy_section, "title", "") or "").strip()
        if not key or not title:
            report.warn("自建分区缺少 key/title，已跳过（内容丢失风险需人工核对）")
            continue
        entries: list[ResumeEntry] = []
        for index, legacy_entry in enumerate(getattr(legacy_section, "entries", []) or []):
            stable_entry_id = _entry_id(legacy_entry, fallback_attr="entry_id")
            scope = stable_entry_id or ("idx" + str(index))
            items = _cap_items(
                build_custom_section_items(legacy_entry, report, hints.get(key), scope=scope),
                report,
                key,
            )
            if not items:
                continue
            entries.append(
                ResumeEntry(
                    id=stable_entry_id or stable_object_id("ob_", key, scope),
                    hidden=bool(getattr(legacy_entry, "hidden", False)),
                    items=items,
                )
            )
        if entries:
            sections.append(ResumeSection(key=key, title=title, kind="entries", entries=entries))
    return sections


def _entry_id(entry: Any, *, fallback_attr: str = "id") -> str | None:
    raw = str(getattr(entry, fallback_attr, "") or "").strip()
    if not raw:
        return None
    from .document_identity import is_object_id

    return raw if is_object_id(raw) else None


def _ordered_sections(
    sections: list[ResumeSection], format_config: Mapping[str, Any]
) -> list[ResumeSection]:
    by_key = {section.key: section for section in sections}
    ordered: list[ResumeSection] = []
    for key in normalized_section_order(format_config.get("section_order")):
        section = by_key.pop(key, None)
        if section is not None:
            ordered.append(section)
    # 兜底：不在标准顺序里的系统分区（理论上不会发生）与自建分区按出现顺序追加。
    ordered.extend(by_key.values())
    return ordered


def _apply_field_layout(sections: list[ResumeSection], format_config: Mapping[str, Any]) -> None:
    """v1 format_config.field_layout -> v2 SectionLayout/EntryLayout（计划 §7.4）。"""
    raw = format_config.get("field_layout")
    if not isinstance(raw, Mapping):
        return
    by_key = {section.key: section for section in sections}
    for key in FIELD_LAYOUT_SECTIONS:
        section = by_key.get(key)
        config = raw.get(key)
        if section is None or not isinstance(config, Mapping):
            continue
        _apply_section_layout(section, config)
    entry_configs = raw.get("entries")
    if not isinstance(entry_configs, Mapping):
        return
    for key, per_entry in entry_configs.items():
        section = by_key.get(str(key))
        if section is None or not isinstance(per_entry, Mapping):
            continue
        for entry in section.entries:
            config = per_entry.get(entry.id or "")
            if isinstance(config, Mapping):
                _apply_entry_layout(entry, config)


def _apply_section_layout(section: ResumeSection, config: Mapping[str, Any]) -> None:
    columns = config.get("columns")
    if isinstance(columns, int) and 1 <= columns <= 3:
        section.layout.columns = columns  # type: ignore[assignment]
    align = config.get("align")
    if align in ("equal", "flow"):
        section.layout.align = align  # type: ignore[assignment]
    gap = _gap_value(config.get("gap"))
    if gap is not None:
        section.layout.gap = gap
    if str(config.get("meta_position") or "") == "above":
        for entry in section.entries:
            _swap_lead_trail(entry)
    for entry in section.entries:
        _apply_key_flags(entry, config)


def _apply_entry_layout(entry: ResumeEntry, config: Mapping[str, Any]) -> None:
    columns = config.get("columns")
    if isinstance(columns, int) and 1 <= columns <= 3:
        entry.layout.columns = columns  # type: ignore[assignment]
    align = config.get("align")
    if align in ("equal", "flow"):
        entry.layout.align = align  # type: ignore[assignment]
    gap = _gap_value(config.get("gap"))
    if gap is not None:
        entry.layout.gap = gap
    if str(config.get("meta_position") or "") == "above":
        _swap_lead_trail(entry)
    _apply_key_flags(entry, config)


def _gap_value(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return min(max(value, 0.0), 30.0)


def _grey_items(entry: ResumeEntry) -> list[Any]:
    return [
        item
        for item in entry.items
        if not isinstance(item, TextItem) and item.placement in _VALID_V2_PLACEMENTS
    ]


def _swap_lead_trail(entry: ResumeEntry) -> None:
    for item in _grey_items(entry):
        item.placement = "trail" if item.placement == "lead" else "lead"


def _apply_key_flags(entry: ResumeEntry, config: Mapping[str, Any]) -> None:
    solo = {str(key) for key in config.get("solo") or () if str(key)}
    hidden = {str(key) for key in config.get("hidden") or () if str(key)}
    for item in _grey_items(entry):
        if item.key in solo:
            item.solo = True
        if item.key in hidden:
            item.placement = "hidden"
    order = [str(key) for key in config.get("order") or () if str(key)]
    if order:
        _reorder_grey(entry, order)


def _reorder_grey(entry: ResumeEntry, order: list[str]) -> None:
    """按 v1 field_layout.order 重排灰字段（只影响 lead/trail，正文/标题顺序不动）。"""
    grey = _grey_items(entry)
    if len(grey) < 2:
        return
    index = {key: position for position, key in enumerate(order)}
    ranked = sorted(
        enumerate(grey),
        key=lambda pair: (index.get(pair[1].key, len(order) + pair[0]), pair[0]),
    )
    queue = [item for _, item in ranked]
    rebuilt: list[Any] = []
    for item in entry.items:
        if not isinstance(item, TextItem) and item.placement in _VALID_V2_PLACEMENTS:
            rebuilt.append(queue.pop(0))
        else:
            rebuilt.append(item)
    entry.items = rebuilt
