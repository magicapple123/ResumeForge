# SPDX-License-Identifier: Apache-2.0
"""Native fact-lock anchors, with read-only handling of historical relative paths."""

import json
from typing import Any

from .document_paths import identity_path, read_document_value, resolve_document_path


def resolve_lock_target(
    document: dict,
    object_id: str | None,
    point_id: str | None,
    path: str | None,
) -> tuple[str, str, str, Any]:
    if object_id:
        target = identity_path(document, object_id, point_id)
        if target is None:
            raise ValueError("要锁定的块在当前正文里找不到")
        if path and target.item is None:
            parts = path.split(".")
            if parts[0] != target.section or len(parts) < 2:
                raise ValueError("锁定路径必须位于指定对象内")
            if not parts[1].isdigit() and parts[1] != object_id:
                raise ValueError("锁定路径必须位于指定对象内")
            target = resolve_document_path(
                document, target.path + ("." + ".".join(parts[2:]) if len(parts) > 2 else "")
            )
        elif path and target.item is not None and path.startswith(target.path + "."):
            target = resolve_document_path(document, path)
    else:
        target = resolve_document_path(document, path or "")
    if target is None:
        raise ValueError("要锁定的路径在当前正文里找不到")
    # New locks store canonical nodes. Legacy-list expansion is only for reading old rows.
    target = resolve_document_path(document, target.path)
    if target is None:
        raise ValueError("要锁定的路径在当前正文里找不到")
    relative = target.date_part or ".".join(target.suffix)
    if target.group and target.entry is not None:
        relative = "@body"
    field = target.date_part or (
        target.suffix[-1] if target.suffix else (target.item or {}).get("key") or target.section
    )
    return target.path, relative, field, target.read()


def current_lock_path(document: dict, lock: Any) -> str | None:
    if lock.object_id:
        target = identity_path(document, lock.object_id, lock.point_id)
        if target is None:
            return None
        path = target.path + ("." + lock.relative_path if lock.relative_path else "")
        return path if resolve_document_path(document, path) is not None else None
    if lock.path and resolve_document_path(document, lock.path) is not None:
        return lock.path
    return None


def legacy_object_lock_matches(document: dict, lock: Any, path: str) -> bool | None:
    """Compare an old aggregate lock field by field, including its historical 500-char prefix.

    This only interprets persisted lock payloads. It never creates a slot-model document.
    IDs still anchor the object; visibility and bookkeeping are not factual values.
    """
    parts = (lock.path or "").split(".")
    text = str(lock.locked_value or "")
    target = resolve_document_path(document, path)
    if (
        len(parts) != 2
        or not parts[1].isdigit()
        or not text.startswith("{")
        or target is None
        or target.item is not None
        or target.entry is None
    ):
        return None
    decoder = json.JSONDecoder()
    ignored = {"point_ids", "hidden_points", "hidden", "lock_content", "lock_layout"}
    missing = object()
    offset = 1
    while offset < len(text):
        while offset < len(text) and text[offset] in " ,":
            offset += 1
        if offset >= len(text) or text[offset] == "}":
            return True
        try:
            key, offset = decoder.raw_decode(text, offset)
        except json.JSONDecodeError:
            return True  # The old stored prefix ended partway through a key.
        if not isinstance(key, str) or offset >= len(text) or text[offset] != ":":
            return False
        offset += 1
        actual = (
            target.entry["id"]
            if key == "id"
            else read_document_value(
                document, f"{target.section}.{target.entry['id']}.{key}", missing
            )
        )
        try:
            expected, end = decoder.raw_decode(text, offset)
        except json.JSONDecodeError:
            if key in ignored:
                return True
            if actual is missing:
                return False
            serialized = json.dumps(
                actual, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            return serialized.startswith(text[offset:])
        if key not in ignored:
            if key == "id" and expected is None:
                pass  # A converter-generated ID is not a change to an old anonymous fact.
            elif (
                actual is missing
                and expected not in (None, "", [])
                or actual is not missing
                and actual != expected
            ):
                return False
        offset = end
    return True
