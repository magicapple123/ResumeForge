# SPDX-License-Identifier: Apache-2.0
"""命名版本比较的字段级变更集（#28b）。

版本比较此前把整份 v2 文档序列化后做行级 diff，用户读到的是
`{"header": {"items": [{"format": "text", "id": "hd_…"` 这类内部结构。
这里改用稳定身份（header item / section entry / entry item）对齐两份 v2 文档，
只输出可读的「字段：旧值 → 新值」。

约束：

- 只读内存，不改任何持久化数据，也不新增第二套文档模型；
- 只报**内容**变化（item 的文本/值）；位置、隐藏、排版由 layout 差异负责；
- 条目/板块的新增与删除只报一条，条目内字段变化逐项报；
- 上限 `MAX_CHANGES` 条，超出截断并置 `truncated`，避免大文档把响应撑爆；
- 照片（base64 派生值）不参与字段比较：它不是可读文本，界面上也没有「旧值/新值」可言。
"""

from __future__ import annotations

from typing import Any

MAX_CHANGES = 200
MAX_VALUE_CHARS = 500

HEADER_SCOPE = "header"
_DOCUMENT_SCOPE = "section"
_ENTRY_SCOPE = "entry"
_ITEM_SCOPE = "item"


def _clip(value: Any) -> str:
    text = "" if value is None else str(value)
    if len(text) <= MAX_VALUE_CHARS:
        return text
    return text[: MAX_VALUE_CHARS - 1] + "…"


def _item_text(item: dict[str, Any]) -> str:
    """item 的可读文本：列表用「；」连接，作者串用「、」连接。"""
    kind = item.get("kind")
    if kind == "text":
        return _clip(item.get("text"))
    if kind == "list":
        return _clip("；".join(str(value) for value in item.get("values") or []))
    if kind == "authors":
        names = [str(author.get("name") or "") for author in item.get("authors") or []]
        return _clip("、".join(name for name in names if name))
    return _clip(item.get("value"))


def _item_identity(item: dict[str, Any], index: int) -> str:
    item_id = item.get("id")
    if item_id:
        return f"id:{item_id}"
    return f"key:{item.get('key') or ''}#{index}"


def _index_items(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        indexed.setdefault(_item_identity(item, index), item)
    return indexed


def _entry_identity(entry: dict[str, Any], index: int) -> str:
    entry_id = entry.get("id")
    if entry_id:
        return f"id:{entry_id}"
    return f"index:{index}"


def _entry_label(entry: dict[str, Any]) -> str:
    """条目可读名：标题类 item 的文本优先，其次第一个非空正文/文本 item。"""
    title_keys = {"title", "company", "school", "name", "organization", "role"}
    fallback = ""
    for item in entry.get("items") or []:
        text = _item_text(item)
        if not text:
            continue
        if item.get("placement") == "title" or item.get("key") in title_keys:
            return text
        if not fallback:
            fallback = text
    return fallback


def _section_title(section: dict[str, Any]) -> str:
    return str(section.get("title") or section.get("key") or "")


def _change(
    *,
    path: str,
    kind: str,
    scope: str,
    old_value: str | None,
    new_value: str | None,
    section_key: str = "",
    section_title: str = "",
    entry_id: str = "",
    entry_label: str = "",
    item_key: str = "",
    item_label: str = "",
) -> dict[str, Any]:
    return {
        "path": path,
        "kind": kind,
        "scope": scope,
        "section_key": section_key,
        "section_title": section_title,
        "entry_id": entry_id,
        "entry_label": entry_label,
        "item_key": item_key,
        "item_label": item_label,
        "old_value": old_value,
        "new_value": new_value,
    }


class _Collector:
    """按文档顺序累积变更；超过上限后丢尾并记 truncated。"""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.truncated = False

    def add(self, change: dict[str, Any]) -> None:
        if len(self.items) >= MAX_CHANGES:
            self.truncated = True
            return
        self.items.append(change)


def _compare_items(
    base_items: list[dict[str, Any]],
    against_items: list[dict[str, Any]],
    collector: _Collector,
    *,
    path_prefix: str,
    scope: str,
    section_key: str = "",
    section_title: str = "",
    entry_id: str = "",
    entry_label: str = "",
) -> None:
    base_indexed = _index_items(base_items)
    against_indexed = _index_items(against_items)
    for identity, item in against_indexed.items():
        key = str(item.get("key") or "")
        label = str(item.get("label") or "")
        if scope == HEADER_SCOPE and key == "photo":
            # 照片是 base64 派生值：不报"旧值/新值"，避免把长串塞进比较面板。
            continue
        current = _item_text(item)
        if identity not in base_indexed:
            collector.add(
                _change(
                    path=f"{path_prefix}.{item.get('id') or key}",
                    kind="added",
                    scope=scope,
                    old_value=None,
                    new_value=current,
                    section_key=section_key,
                    section_title=section_title,
                    entry_id=entry_id,
                    entry_label=entry_label,
                    item_key=key,
                    item_label=label,
                )
            )
            continue
        previous = _item_text(base_indexed[identity])
        if previous == current:
            continue
        collector.add(
            _change(
                path=f"{path_prefix}.{item.get('id') or key}",
                kind="changed",
                scope=scope,
                old_value=previous,
                new_value=current,
                section_key=section_key,
                section_title=section_title,
                entry_id=entry_id,
                entry_label=entry_label,
                item_key=key,
                item_label=label,
            )
        )
    for identity, item in base_indexed.items():
        if identity in against_indexed:
            continue
        key = str(item.get("key") or "")
        if scope == HEADER_SCOPE and key == "photo":
            continue
        collector.add(
            _change(
                path=f"{path_prefix}.{item.get('id') or key}",
                kind="removed",
                scope=scope,
                old_value=_item_text(item),
                new_value=None,
                section_key=section_key,
                section_title=section_title,
                entry_id=entry_id,
                entry_label=entry_label,
                item_key=key,
                item_label=str(item.get("label") or ""),
            )
        )


def build_field_changes(
    base: dict[str, Any] | None, against: dict[str, Any] | None
) -> tuple[list[dict[str, Any]], bool]:
    """两份 v2 文档 → 字段级变更集（按文档顺序）与是否截断。"""
    collector = _Collector()
    base_doc = base or {}
    against_doc = against or {}
    base_header = (base_doc.get("header") or {}).get("items") or []
    against_header = (against_doc.get("header") or {}).get("items") or []
    _compare_items(
        base_header, against_header, collector, path_prefix=HEADER_SCOPE, scope=HEADER_SCOPE
    )

    base_sections = {
        str(section.get("key") or ""): section for section in base_doc.get("sections") or []
    }
    against_sections = {
        str(section.get("key") or ""): section for section in against_doc.get("sections") or []
    }
    for section_key, section in against_sections.items():
        title = _section_title(section)
        if section_key not in base_sections:
            collector.add(
                _change(
                    path=section_key,
                    kind="added",
                    scope=_DOCUMENT_SCOPE,
                    old_value=None,
                    new_value=title,
                    section_key=section_key,
                    section_title=title,
                )
            )
            continue
        base_entries = base_sections[section_key].get("entries") or []
        against_entries = section.get("entries") or []
        base_indexed = {_entry_identity(entry, i): entry for i, entry in enumerate(base_entries)}
        against_indexed = {
            _entry_identity(entry, i): entry for i, entry in enumerate(against_entries)
        }
        for identity, entry in against_indexed.items():
            label = _entry_label(entry)
            entry_id = str(entry.get("id") or "")
            if identity not in base_indexed:
                collector.add(
                    _change(
                        path=f"{section_key}.{entry_id}" if entry_id else section_key,
                        kind="added",
                        scope=_ENTRY_SCOPE,
                        old_value=None,
                        new_value=label,
                        section_key=section_key,
                        section_title=title,
                        entry_id=entry_id,
                        entry_label=label,
                    )
                )
                continue
            _compare_items(
                base_indexed[identity].get("items") or [],
                entry.get("items") or [],
                collector,
                path_prefix=f"{section_key}.{entry_id}" if entry_id else section_key,
                scope=_ITEM_SCOPE,
                section_key=section_key,
                section_title=title,
                entry_id=entry_id,
                entry_label=label,
            )
        for identity, entry in base_indexed.items():
            if identity in against_indexed:
                continue
            label = _entry_label(entry)
            collector.add(
                _change(
                    path=f"{section_key}.{entry.get('id') or ''}",
                    kind="removed",
                    scope=_ENTRY_SCOPE,
                    old_value=label,
                    new_value=None,
                    section_key=section_key,
                    section_title=title,
                    entry_id=str(entry.get("id") or ""),
                    entry_label=label,
                )
            )
    for section_key, section in base_sections.items():
        if section_key in against_sections:
            continue
        collector.add(
            _change(
                path=section_key,
                kind="removed",
                scope=_DOCUMENT_SCOPE,
                old_value=_section_title(section),
                new_value=None,
                section_key=section_key,
                section_title=_section_title(section),
            )
        )
    return collector.items, collector.truncated


__all__ = ["MAX_CHANGES", "build_field_changes"]
