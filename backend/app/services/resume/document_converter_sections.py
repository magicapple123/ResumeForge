# SPDX-License-Identifier: Apache-2.0
"""v1 -> v2 的逐分区字段映射（D11：文字与条目不丢）。

转换原则：v1 的每个非空字段只有两种去路——识别成一个 v2 item，或原样保留成文本块
（TextItem）；不存在第三条"丢弃"路径。承载区（achievements / description / note /
content）里的「标签：值」行，只有在拿到当前资料库的自定义字段定义（CustomFieldHint）
时才识别成 FieldItem；没有定义时保守地整行保留为文本并记入报告（不猜业务含义）。

本模块只做"一条 v1 条目 -> 一串 v2 items"的映射，不碰 format_config/layout（在
document_converter 主模块处理），只进行向前转换。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ...schemas.resume_document import (
    AuthorsItem,
    FieldItem,
    FieldSource,
    ListItem,
    Placement,
    ResumeItem,
    TextItem,
)
from ...schemas.resume_research import ResumeAuthor
from . import document_catalog as catalog
from .document_conversion_types import ConversionReport, CustomFieldHint, stable_object_id
from .document_converter_custom import extract_custom_field_items
from .document_converter_specs import ENTRY_SPECS

__all__ = [
    "PROFILE_TO_DOC_SECTION",
    "build_entry_items",
    "hints_by_doc_section",
    "period_value",
]

#: 资料分区 key -> v2 文档分区 key（自定义分区不在表里，按原 key 直通）。
PROFILE_TO_DOC_SECTION: dict[str, str] = {
    spec.profile_key: spec.key for spec in catalog.SECTION_ORDER
}

_TITLE_OR_META = frozenset(("title", "meta"))


def _text(value: Any) -> str:
    return str(value or "").strip()


def _valid_id(value: Any) -> str | None:
    text = _text(value)
    return text or None


def hints_by_doc_section(
    hints: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None,
) -> dict[str, tuple[CustomFieldHint, ...]]:
    """资料分区 key -> v2 分区 key 的提示表（保持定义顺序；坏项跳过不崩）。"""
    if not hints:
        return {}
    grouped: dict[str, list[CustomFieldHint]] = {}
    for raw_key, rows in hints.items():
        section_key = PROFILE_TO_DOC_SECTION.get(str(raw_key), str(raw_key))
        for row in rows or ():
            if isinstance(row, CustomFieldHint):
                hint = row
            else:
                data = dict(row)
                data.setdefault("section_key", str(raw_key))
                hint = CustomFieldHint(**data)
            label = _text(hint.label)
            if not label:
                continue
            grouped.setdefault(section_key, []).append(
                CustomFieldHint(
                    section_key=str(hint.section_key or raw_key),
                    field_id=str(hint.field_id or ""),
                    label=label,
                    field_type=str(hint.field_type or "single_line"),
                    default_placement=str(hint.default_placement or "trail"),
                    material_only=bool(hint.material_only),
                )
            )
    return {key: tuple(rows) for key, rows in grouped.items()}


def _source(section_key: str, item_key: str) -> FieldSource | None:
    field_id = catalog.profile_field_id(section_key, item_key)
    spec = catalog.section_spec(section_key)
    if not field_id or spec is None:
        return None
    return FieldSource(section_key=spec.profile_key, field_id=field_id)


def _field_item(
    section_key: str,
    item_key: str,
    value: Any,
    *,
    placement: Placement | None = None,
    fmt: str | None = None,
    label: str = "",
    show_label: bool | None = None,
    wrap: str | None = None,
    body_style: str | None = None,
    scope: str = "",
    report: ConversionReport,
) -> FieldItem | None:
    text = _text(value)
    if not text:
        return None
    spec = catalog.field_spec(section_key, item_key)
    resolved: Placement = placement or (spec.default_placement if spec is not None else "trail")
    if show_label is None:
        # title/meta 不需要前缀；lead/trail 的「标签：值」需要；body 的内置字段（技能名/
        # 语言等级）也不带前缀（它们本来就是一行里的自然文字，plan §5.2 inline 口径）。
        show_label = resolved in ("lead", "trail", "hidden")
    report.fields_recognized += 1
    return FieldItem(
        id=stable_object_id("it_", section_key, scope, item_key, "field"),
        key=item_key,
        label=label,
        value=text,
        placement=resolved,
        format=fmt or (spec.fmt if spec is not None else "text"),
        wrap=wrap or (spec.wrap if spec is not None else "none"),
        show_label=show_label,
        body_style=body_style or (spec.body_style if spec is not None else "bullet"),
        source=_source(section_key, item_key),
    )


def _list_item(
    section_key: str,
    item_key: str,
    values: Any,
    *,
    placement: Placement | None = None,
    scope: str = "",
    report: ConversionReport,
    hidden_point_ids: frozenset[str] | None = None,
    point_ids: Any = None,
) -> ListItem | None:
    raw_values = list(values or ())
    value_ids = list(point_ids or ()) if isinstance(point_ids, (list, tuple)) else []
    hidden = hidden_point_ids or frozenset()
    cleaned: list[str] = []
    hidden_values: list[str] = []
    for index, raw in enumerate(raw_values):
        text = _text(raw)
        if not text:
            continue
        point_id = value_ids[index] if index < len(value_ids) else ""
        if point_id and point_id in hidden:
            hidden_values.append(text)
        else:
            cleaned.append(text)
    if not cleaned and not hidden_values:
        return None
    spec = catalog.field_spec(section_key, item_key)
    resolved: Placement = placement or (spec.default_placement if spec is not None else "trail")
    report.fields_recognized += 1
    return ListItem(
        id=stable_object_id("it_", section_key, scope, item_key, "list"),
        key=item_key,
        values=cleaned,
        hidden_values=hidden_values,
        placement=resolved,
        join=spec.join if spec is not None else "semicolon",
        show_label=resolved not in _TITLE_OR_META,
        source=_source(section_key, item_key),
    )


def _authors_item(
    section_key: str,
    item_key: str,
    authors: Any,
    *,
    scope: str = "",
    report: ConversionReport,
) -> AuthorsItem | None:
    cleaned: list[ResumeAuthor] = []
    for raw in authors or ():
        if isinstance(raw, ResumeAuthor):
            name, is_self, corresponding = raw.name, raw.is_self, raw.corresponding
        else:
            data = dict(raw or {})
            name = str(data.get("name") or "")
            is_self = bool(data.get("is_self"))
            corresponding = bool(data.get("corresponding"))
        if not name.strip():
            continue
        cleaned.append(
            ResumeAuthor(name=name.strip(), is_self=is_self, corresponding=corresponding)
        )
    if not cleaned:
        return None
    report.fields_recognized += 1
    return AuthorsItem(
        id=stable_object_id("it_", section_key, scope, item_key, "authors"),
        key=item_key,
        authors=cleaned,
        placement="trail",
        show_label=True,
        source=_source(section_key, item_key),
    )


def period_value(entry: Any) -> str:
    """v1 的 start_date/end_date -> 一个规范值（start|end；空端保留位）。"""
    start = _text(getattr(entry, "start_date", ""))
    end = _text(getattr(entry, "end_date", ""))
    if not start and not end:
        return ""
    return start + "|" + end


def _body_items(
    section_key: str,
    attr: str,
    lines: Any,
    *,
    point_ids: Mapping[str, Sequence[str]] | None,
    hidden_point_ids: frozenset[str] | None,
    style: str,
    scope: str = "",
    report: ConversionReport,
) -> list[TextItem]:
    ids = list((point_ids or {}).get(attr) or ())
    hidden = hidden_point_ids or frozenset()
    raw_lines = lines if isinstance(lines, (list, tuple)) else str(lines or "").split("\n")
    items: list[TextItem] = []
    for index, raw in enumerate(raw_lines):
        text = _text(raw)
        if not text:
            continue
        point_id = ids[index] if index < len(ids) else ""
        items.append(
            TextItem(
                id=_valid_id(point_id) or stable_object_id("pt_", section_key, scope, attr, index),
                style=style if style in ("bullet", "paragraph") else "bullet",
                text=text,
                hidden=bool(point_id and point_id in hidden),
            )
        )
        report.lines_preserved += 1
    return items


def _hidden_point_ids(entry: Any) -> frozenset[str]:
    """v1 hidden_points（要点 id 子集）-> frozenset；坏值忽略（读旧数据不崩）。"""
    raw = getattr(entry, "hidden_points", None)
    if not isinstance(raw, (list, tuple)):
        return frozenset()
    return frozenset(str(value) for value in raw if isinstance(value, str) and value)


def _text_items_for(
    section_key: str,
    entry: Any,
    text_attrs: Sequence[tuple[str, str, str]],
    report: ConversionReport,
    scope: str = "",
) -> list[ResumeItem]:
    point_ids = getattr(entry, "point_ids", None)
    hidden_point_ids = _hidden_point_ids(entry)
    items: list[ResumeItem] = []
    for _item_key, attr, style in text_attrs:
        items.extend(
            _body_items(
                section_key,
                attr,
                getattr(entry, attr, ""),
                point_ids=point_ids if isinstance(point_ids, Mapping) else None,
                hidden_point_ids=hidden_point_ids,
                style=style,
                scope=scope,
                report=report,
            )
        )
    return items


def build_entry_items(
    section_key: str,
    entry: Any,
    report: ConversionReport,
    hints: Mapping[str, Sequence[CustomFieldHint]] | None = None,
    scope: str = "",
) -> list[ResumeItem]:
    """一条 v1 条目 -> v2 items；未知分区返回空列表（调用方记 warning）。"""
    spec = ENTRY_SPECS.get(section_key)
    if spec is None:
        return []
    items: list[ResumeItem] = []
    scope = scope or _valid_id(getattr(entry, "id", "")) or section_key + "-entry"
    for item_key, attr, placement, fmt, wrap in spec["fields"]:
        item = _field_item(
            section_key,
            item_key,
            getattr(entry, attr, ""),
            placement=placement,
            fmt=fmt,
            wrap=wrap,
            scope=scope,
            report=report,
        )
        if item is not None:
            items.append(item)
    if spec["period"]:
        period = _field_item(
            section_key,
            "period",
            period_value(entry),
            placement="meta",
            fmt="date_range",
            show_label=False,
            scope=scope,
            report=report,
        )
        if period is not None:
            items.append(period)
    all_point_ids = getattr(entry, "point_ids", None)
    hidden_point_ids = _hidden_point_ids(entry)
    for item_key, attr, placement in spec["lists"]:
        listed = _list_item(
            section_key,
            item_key,
            getattr(entry, attr, []),
            placement=placement,
            report=report,
            scope=scope,
            hidden_point_ids=hidden_point_ids,
            point_ids=(all_point_ids or {}).get(attr)
            if isinstance(all_point_ids, Mapping)
            else None,
        )
        if listed is not None:
            items.append(listed)
    for item_key, attr in spec.get("authors", ()):
        authors = _authors_item(
            section_key, item_key, getattr(entry, attr, []), report=report, scope=scope
        )
        if authors is not None:
            items.append(authors)
    items.extend(_text_items_for(section_key, entry, spec["texts"], report, scope=scope))
    hint_list = (hints or {}).get(section_key, ())
    if hint_list:
        return extract_custom_field_items(items, section_key, hint_list, report)
    return items


# 自定义字段解析在 document_converter_custom（承载区「标签：值」行 -> FieldItem），
# 这里 re-export 保持「逐分区映射」的公共导入面只有一处。
