# SPDX-License-Identifier: Apache-2.0
"""Collect and insert phrase text directly on native document nodes."""

from collections.abc import Callable

from .document_catalog import section_spec
from .document_paths import resolve_document_path

_SCALAR = {"skills": "name", "awards": "description"}
_POINT_SECTIONS = {"education", "experience", "campus_experience", "projects"}


def collect_document_text(document: dict, path: str) -> tuple[str, str, str | None, str]:
    target = resolve_document_path(document, path)
    if target is None or target.entry is None:
        raise ValueError("路径不在可收藏的简历条目里")
    value = target.read()
    if not isinstance(value, str) or not value.strip():
        raise ValueError("只能收藏一段非空文本")
    item = target.item or {}
    field = item.get("key") or ("description" if item.get("kind") == "text" else "")
    return value.strip(), target.entry["id"], item.get("id"), field


def insert_document_phrase(
    document: dict,
    section: str,
    entry_id: str | None,
    text: str,
    point_index: int | None,
    new_id: Callable[[], str],
) -> tuple[str, str | None, str]:
    if section not in _POINT_SECTIONS | set(_SCALAR):
        raise ValueError("栏目不支持插入")
    target_section = next((s for s in document["sections"] if s["key"] == section), None)
    if target_section is None:
        spec = section_spec(section)
        target_section = {"key": section, "kind": spec.kind, "entries": []}
        document["sections"].append(target_section)
    if entry_id is not None:
        entry = next((e for e in target_section["entries"] if e["id"] == entry_id), None)
        if entry is None:
            raise ValueError("条目不在当前简历里")
        if section in _SCALAR:
            raise ValueError("这个栏目没有可插入的要点数组，请不指定 entry_id 以新建条目")
    else:
        entry = {"id": new_id(), "items": []}
        target_section["entries"].append(entry)
    item_id = new_id()
    if section in _SCALAR:
        item = {
            "kind": "field",
            "id": item_id,
            "key": _SCALAR[section],
            "value": text,
            "placement": "body",
            "show_label": False,
        }
        point_id = None
    else:
        item = {"kind": "text", "id": item_id, "text": text, "style": "bullet"}
        point_id = item_id
    items = entry["items"]
    texts = [i for i in items if i.get("kind") == "text" and not i.get("hidden")]
    index = len(texts) if point_index is None else max(0, min(point_index, len(texts)))
    offset = items.index(texts[index]) if index < len(texts) else len(items)
    items.insert(offset, item)
    return entry["id"], point_id, f"{section}.{entry['id']}.{item_id}"
