# SPDX-License-Identifier: Apache-2.0
"""v1 format_config 的布局迁移（从 app.services.resume.document_converter 纯搬迁拆出）。

把 v1 field_layout（分区列数 / 对齐 / gap / meta_position + 条目级 solo/hidden/order）
落成 v2 的 SectionLayout / EntryLayout。纯数据迁移，不依赖 DB / 渲染；document_converter
在 convert_content 里调用 _apply_field_layout，其余函数只在本模块内使用。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...schemas.resume_document import ResumeEntry, ResumeSection, TextItem

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
