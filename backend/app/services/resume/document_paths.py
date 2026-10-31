# SPDX-License-Identifier: Apache-2.0
"""Resolve native identities and historical paths without projecting a v1 model.

Stable entry/item IDs take precedence. Historical indices retain the former visible
analysis order; unresolved identities never fall back to another entry by index.
All functions operate in memory. Persisted paths and database columns stay untouched.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .document_identity import POINT_FIELDS
from .document_view import header_items, iter_entries

_CARRIERS = {
    "education": "achievements",
    "experience": "description",
    "projects": "description",
    "campus_experience": "description",
    "research_projects": "description",
    "awards": "description",
}


def item_value(item: dict) -> Any:
    return item.get(
        {"text": "text", "list": "values", "authors": "authors"}.get(item.get("kind"), "value"), ""
    )


def _visible(item: dict) -> bool:
    return not item.get("hidden") and item.get("placement") != "hidden"


def _carrier_items(section: str, items: list[dict]) -> tuple[dict, ...]:
    """Map nodes that contributed to a historical prose array, in that order."""
    fields = POINT_FIELDS.get(section, ())
    return tuple(
        item
        for item in items
        if _visible(item)
        and (
            item.get("kind") == "text"
            or item.get("kind") == "field"
            and item.get("placement") == "body"
            and not (item.get("key") == "period" and item.get("format") == "date_range")
            or item.get("kind") == "list"
            and item.get("key") not in fields
        )
    )


def _carrier_text(item: dict) -> str:
    value = item_value(item)
    if isinstance(value, list):
        value = ("；" if item.get("join") == "semicolon" else "、").join(str(v) for v in value)
    label = item.get("label") or ""
    return f"{label}：{value}" if label else str(value)


def _walk(value: Any, suffix: tuple[str, ...], default: Any) -> Any:
    for part in suffix:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return default
    return value


@dataclass
class DocumentPath:
    path: str
    section: str
    entry: dict | None = None
    item: dict | None = None
    suffix: tuple[str, ...] = ()
    group: tuple[dict, ...] = ()
    group_text: bool = False
    date_part: str = ""
    legacy_values: bool = False
    legacy_label: bool = False
    scalar_list: bool = False

    def read(self, default: Any = None) -> Any:
        if self.group:
            values = [
                _carrier_text(item) if self.legacy_label else str(item_value(item))
                for item in self.group
            ]
            value = "\n".join(values) if self.group_text else values
        elif self.item is not None:
            value = item_value(self.item)
            if self.legacy_values and self.item.get("kind") == "list":
                value = [*value, *(self.item.get("hidden_values") or [])]
            if self.legacy_label:
                value = _carrier_text(self.item)
            if self.scalar_list:
                value = [value]
        elif self.entry is not None:
            value = self.entry
        else:
            return default
        if self.date_part:
            start, _, end = str(value).partition("|")
            value = start.strip() if self.date_part == "start_date" else end.strip()
        return _walk(value, self.suffix, default)


def _item_target(
    section: str,
    entry: dict | None,
    item: dict,
    suffix: tuple[str, ...] = (),
    *,
    legacy_values: bool = False,
) -> DocumentPath | None:
    base = f"{section}.{entry['id']}.{item['id']}" if entry is not None else f"header.{item['id']}"
    if item.get("key") == "period" and len(suffix) == 1 and suffix[0] in {"start_date", "end_date"}:
        return DocumentPath(base + "." + suffix[0], section, entry, item, date_part=suffix[0])
    target = DocumentPath(
        base + ("." + ".".join(suffix) if suffix else ""),
        section,
        entry,
        item,
        suffix=suffix,
        legacy_values=legacy_values,
    )
    missing = object()
    return None if target.read(missing) is missing else target


def identity_path(
    document: dict, object_id: str, point_id: str | None = None
) -> DocumentPath | None:
    for key, entry in iter_entries(document):
        if entry.get("id") != object_id:
            continue
        if point_id is None:
            return DocumentPath(f"{key}.{object_id}", key, entry=entry)
        for item in entry.get("items") or []:
            if item.get("id") == point_id:
                return DocumentPath(f"{key}.{object_id}.{point_id}", key, entry, item)
        return None
    for item in header_items(document):
        if item.get("id") == object_id and point_id in {None, object_id}:
            return DocumentPath(f"header.{object_id}", "header", item=item)
    return None


def resolve_document_path(document: dict, path: str) -> DocumentPath | None:
    """Resolve a path to existing nodes; both native and historical syntax work."""
    if not isinstance(document, dict) or document.get("version") != 2:
        return None
    parts = tuple(str(path or "").split("."))
    if not all(parts):
        return None
    head = parts[0]
    if head == "header" or len(parts) == 1 and head != "summary":
        token = parts[1] if head == "header" and len(parts) >= 2 else head
        for item in header_items(document):
            aliases = {item.get("id"), item.get("key")}
            if item.get("key") in {"intent", "job_intent"}:
                aliases.update({"intent", "job_intent"})
            if token in aliases:
                suffix = parts[2:] if head == "header" else ()
                if suffix == ("value",):
                    suffix = ()
                return _item_target("header", None, item, suffix)
        return None
    if parts == ("summary",):
        items = tuple(
            item
            for key, entry in iter_entries(document)
            if key == "summary" and not entry.get("hidden")
            for item in entry.get("items") or []
            if _visible(item) and (item.get("kind") == "text" or item.get("placement") == "body")
        )
        return DocumentPath("summary", "summary", group=items, group_text=True) if items else None
    if len(parts) < 2:
        return None
    entries = [entry for key, entry in iter_entries(document) if key == head]
    entry = next((entry for entry in entries if entry.get("id") == parts[1]), None)
    if entry is None and parts[1].isdigit():
        visible_entries = [entry for entry in entries if not entry.get("hidden")]
        index = int(parts[1])
        entry = visible_entries[index] if index < len(visible_entries) else None
    if entry is None:
        return None
    base = f"{head}.{entry['id']}"
    if len(parts) == 2:
        return DocumentPath(base, head, entry=entry)
    token = parts[2]
    items = entry.get("items") or []
    item = next((item for item in items if item.get("id") == token), None)
    if item is not None:
        return _item_target(head, entry, item, parts[3:])
    item = next((item for item in items if item.get("key") == token and _visible(item)), None)
    if item is not None and not (token == _CARRIERS.get(head) and _carrier_items(head, items)):
        if item.get("kind") == "field" and token in POINT_FIELDS.get(head, ()):
            if parts[3:] == ("0",):
                return _item_target(head, entry, item)
            if len(parts) == 3:
                return DocumentPath(f"{base}.{item['id']}", head, entry, item, scalar_list=True)
            return None
        return _item_target(head, entry, item, parts[3:], legacy_values=True)
    if token in {"start_date", "end_date"} and len(parts) == 3:
        period = next(
            (item for item in items if item.get("key") == "period" and _visible(item)), None
        )
        if period is not None:
            return _item_target(head, entry, period, (token,))
    if token in {"@body", _CARRIERS.get(head)}:
        if len(parts) not in {3, 4}:
            return None
        body = _carrier_items(head, items)
        if not body:
            return None
        if len(parts) == 4 and parts[3].isdigit():
            index = int(parts[3])
            if index >= len(body):
                return None
            item = body[index]
            return DocumentPath(f"{base}.{item['id']}", head, entry, item, legacy_label=True)
        return DocumentPath(
            f"{base}.@body",
            head,
            entry=entry,
            group=body,
            group_text=head == "awards",
            legacy_label=True,
        )
    return None


def read_document_value(document: dict, path: str, default: Any = None) -> Any:
    if document.get("version") != 2:
        return _walk(document, tuple(path.split(".")), default)
    target = resolve_document_path(document, path)
    return target.read(default) if target is not None else default


def write_document_value(document: dict, path: str, value: Any) -> bool:
    target = resolve_document_path(document, path)
    if target is None:
        return False
    if target.group:
        if target.group_text and len(target.group) == 1 and isinstance(value, str):
            return _set_item(target.group[0], value)
        values = str(value).splitlines() if target.group_text else value
        if not isinstance(values, list) or len(values) != len(target.group):
            return False
        if not all(
            isinstance(new_value, list if item.get("kind") in {"list", "authors"} else str)
            for item, new_value in zip(target.group, values, strict=True)
        ):
            return False
        return all(
            _set_item(item, new_value) for item, new_value in zip(target.group, values, strict=True)
        )
    if target.item is None:
        return False
    if target.date_part:
        start, _, end = str(item_value(target.item)).partition("|")
        value = f"{value}|{end}" if target.date_part == "start_date" else f"{start}|{value}"
    if target.suffix:
        current = item_value(target.item)
        parent = _walk(current, target.suffix[:-1], None)
        leaf = target.suffix[-1]
        if isinstance(parent, list) and leaf.isdigit() and int(leaf) < len(parent):
            parent[int(leaf)] = value
            return True
        if isinstance(parent, dict) and leaf in parent:
            parent[leaf] = value
            return True
        return False
    return _set_item(target.item, value)


def _set_item(item: dict, value: Any) -> bool:
    kind = item.get("kind")
    key = {"text": "text", "list": "values", "authors": "authors"}.get(kind, "value")
    if kind in {"list", "authors"} and not isinstance(value, list):
        return False
    if kind not in {"list", "authors"} and not isinstance(value, str):
        return False
    item[key] = value
    return True
