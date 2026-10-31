# SPDX-License-Identifier: Apache-2.0
"""v2 文档原生只读访问器。

## 为什么需要这层

v1 `ResumeContent` 是**槽位模型**：每个分区有固定字段名、固定承载区；v2 文档是
**字段级文档**：位置（placement）、顺序、隐藏都是数据。分析/摘要类调用方真正要的往往
只是"某个页眉字段的值"或"某个分区的条目文本"，不该为此把整份文档折回 v1——那是一次
**有损投影**（自定义位置、隐藏语义、自建板块都可能失真）。

本模块只做**读**：不构造 `ResumeContent`、不写库、不缓存，也不猜内容。调用方按需取
最小数据；需要"AI 可读的整份文本"时用 `document_text`（与四出口同一份 paper 语义的
简化版：只拼接可见内容，不做排版）。

历史数据库路径由 document_paths 按原生节点解析；旧版本文档仅通过
document_io.ensure_document_version 向前转换。所有读侧均不改库。

## 形状约定

v2 文档是 dict：`{"version": 2, "header": {"items": [...]}, "sections": [...]}`；
item 的 kind 是 `field / text / list / authors` 之一。本模块对缺字段/脏形状一律返回
空值（读侧不因一份坏数据炸掉调用方），但**不会**修补或写回。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

_TEXT_KINDS = ("text", "list", "authors")


def is_v2_document(content: Any) -> bool:
    """是不是 v2 文档（`version == 2` 且 header/sections 形状齐全）。"""
    if not isinstance(content, Mapping):
        return False
    if content.get("version") != 2:
        return False
    header = content.get("header")
    return isinstance(header, Mapping) and isinstance(header.get("items"), list)


def header_items(document: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """页眉条目（顺序即页眉里的排列顺序）。"""
    if not isinstance(document, Mapping):
        return []
    header = document.get("header")
    if not isinstance(header, Mapping):
        return []
    items = header.get("items")
    return [item for item in items if isinstance(item, Mapping)] if isinstance(items, list) else []


def header_text(document: Mapping[str, Any] | None, key: str, default: str = "") -> str:
    """按字段 key 读页眉的文本值（隐藏字段也算——调用方自己决定可见性语义）。"""
    for item in header_items(document):
        if str(item.get("key") or "") == key:
            value = item.get("value")
            return str(value).strip() if value is not None else default
    return default


def _item_text(item: Mapping[str, Any]) -> str:
    kind = str(item.get("kind") or "")
    if kind == "field":
        return str(item.get("value") or "")
    if kind == "text":
        return str(item.get("text") or "")
    if kind == "list":
        values = item.get("values")
        hidden = set(item.get("hidden_values") or [])
        return (
            " · ".join(str(value) for value in values if value and value not in hidden)
            if isinstance(values, list)
            else ""
        )
    if kind == "authors":
        authors = item.get("authors")
        if not isinstance(authors, list):
            return ""
        return " · ".join(
            str(author.get("name") or "") for author in authors if isinstance(author, Mapping)
        )
    return ""


def iter_entries(
    document: Mapping[str, Any] | None,
) -> list[tuple[str, dict[str, Any]]]:
    """按文档顺序展开 `(section_key, entry)`（跳过非条目分区与坏形状）。"""
    if not isinstance(document, Mapping):
        return []
    sections = document.get("sections")
    if not isinstance(sections, list):
        return []
    result: list[tuple[str, dict[str, Any]]] = []
    for section in sections:
        if not isinstance(section, Mapping):
            continue
        section_key = str(section.get("key") or "")
        entries = section.get("entries")
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, Mapping):
                result.append((section_key, entry))
    return result


def entry_texts(entry: Mapping[str, Any] | None, *, include_hidden: bool = False) -> list[str]:
    """一个条目里所有 item 的文本（默认跳过 hidden 文本项与隐藏 placement 字段）。"""
    if not isinstance(entry, Mapping):
        return []
    items = entry.get("items")
    if not isinstance(items, list):
        return []
    if not include_hidden and entry.get("hidden") is True:
        return []
    texts: list[str] = []
    for item in items:
        if not isinstance(item, Mapping):
            continue
        if not include_hidden and (item.get("hidden") is True or item.get("placement") == "hidden"):
            continue
        text = _item_text(item).strip()
        if text:
            texts.append(text)
    return texts


def document_text(document: Mapping[str, Any] | None) -> str:
    """整份文档的可见文本（页眉 + 各条目 item 文本，按文档顺序；仅作 AI/摘要上下文）。"""
    parts = [
        _item_text(item).strip()
        for item in header_items(document)
        if item.get("placement") not in {"hidden", "photo"}
    ]
    previous_section = ""
    for section_key, entry in iter_entries(document):
        if entry.get("hidden"):
            continue
        if section_key != previous_section:
            parts.append(section_key)
            previous_section = section_key
        for item in entry.get("items") or []:
            if (
                not isinstance(item, Mapping)
                or item.get("hidden")
                or item.get("placement") == "hidden"
            ):
                continue
            value = _item_text(item).strip()
            label = str(item.get("label") or item.get("key") or "")
            if value:
                parts.append(f"{label}: {value}" if label else value)
    return "\n".join(part for part in parts if part)


def field_text(entry: Mapping[str, Any], key: str, default: str = "") -> str:
    """Read one visible field without reconstructing a slot model."""
    for item in entry.get("items") or []:
        if (
            isinstance(item, Mapping)
            and item.get("key") == key
            and item.get("placement") != "hidden"
        ):
            return _item_text(item).strip()
    return default


def section_texts(document: Mapping[str, Any]) -> dict[str, str]:
    """Visible texts grouped by their actual section, including custom sections."""
    result: dict[str, str] = {}
    for key, entry in iter_entries(document):
        result[key] = " ".join([result.get(key, ""), *entry_texts(entry)]).strip()
    return result


@dataclass(frozen=True)
class DocumentTextSlot:
    path: str
    section: str
    object_id: str
    point_id: str
    field: str
    value: str
    format: str = "text"


def text_slots(document: Mapping[str, Any]) -> list[DocumentTextSlot]:
    """Visible values with native paths; metadata and photo bytes are excluded."""
    slots: list[DocumentTextSlot] = []
    for item in header_items(document):
        if item.get("placement") not in {"hidden", "photo"}:
            item_id = str(item.get("id") or "")
            slots.append(
                DocumentTextSlot(
                    f"header.{item_id}",
                    "header",
                    item_id,
                    item_id,
                    str(item.get("key") or ""),
                    str(item.get("value") or ""),
                    str(item.get("format") or "text"),
                )
            )
    for key, entry in iter_entries(document):
        if entry.get("hidden"):
            continue
        for item in entry.get("items") or []:
            if item.get("hidden") or item.get("placement") == "hidden":
                continue
            item_id = str(item.get("id") or "")
            base = f"{key}.{entry['id']}.{item_id}"
            field = str(item.get("key") or "text")
            if item.get("kind") == "list":
                hidden = set(item.get("hidden_values") or [])
                values = [
                    (f"{base}.{index}", value)
                    for index, value in enumerate(item.get("values") or [])
                    if value not in hidden
                ]
            elif item.get("kind") == "authors":
                values = [
                    (f"{base}.{index}.name", author.get("name") or "")
                    for index, author in enumerate(item.get("authors") or [])
                ]
            else:
                values = [(base, _item_text(item))]
            slots.extend(
                DocumentTextSlot(
                    path,
                    key,
                    entry["id"],
                    item_id,
                    field,
                    str(value),
                    str(item.get("format") or "text"),
                )
                for path, value in values
                if value
            )
    return slots


__all__ = [
    "document_text",
    "entry_texts",
    "header_items",
    "header_text",
    "is_v2_document",
    "iter_entries",
    "field_text",
    "section_texts",
    "DocumentTextSlot",
    "text_slots",
]
