# SPDX-License-Identifier: Apache-2.0
"""Native source-block enumeration and persisted-anchor resolution."""

from typing import Any

from .document_identity import is_object_id
from .document_paths import DocumentPath, identity_path, resolve_document_path
from .document_view import entry_texts, field_text, iter_entries


def native_objects(document: dict) -> list[dict]:
    """Keep the established entry/prose block domain and its coverage semantics."""
    kinds = {section["key"]: section.get("kind") for section in document.get("sections") or []}
    result: list[dict] = []
    for key, entry in iter_entries(document):
        if entry.get("hidden") or kinds.get(key) == "text":
            continue
        object_id = entry["id"]
        label = next(
            (
                value
                for name in ("company", "school", "organization", "name", "title", "role")
                if (value := field_text(entry, name))
            ),
            "",
        )
        result.append(
            {
                "path": f"{key}.{object_id}",
                "field": key,
                "object_id": object_id,
                "point_id": None,
                "label": label[:60],
            }
        )
        for item in entry.get("items") or []:
            if item.get("hidden") or item.get("placement") == "hidden":
                continue
            if item.get("kind") != "text" and (
                kinds.get(key) == "inline" or item.get("placement") != "body"
            ):
                continue
            texts = entry_texts({"items": [item]})
            if texts:
                result.append(
                    {
                        "path": f"{key}.{object_id}.{item['id']}",
                        "field": key,
                        "object_id": object_id,
                        "point_id": item["id"],
                        "label": texts[0][:160],
                    }
                )
    return result


def resolve_native_target(
    document: dict, object_id: str | None, point_id: str | None, path: str | None
) -> DocumentPath:
    if object_id is not None:
        if not is_object_id(object_id):
            raise ValueError("对象标识不合法")
        target = identity_path(document, object_id, point_id)
    elif path:
        target = resolve_document_path(document, path)
        if target is not None and point_id and (target.item or {}).get("id") != point_id:
            target = None
    else:
        raise ValueError("需要 object_id 或 path 指定要关联的块")
    if target is None:
        raise ValueError("这个块在当前正文里找不到（可能已被删除或标识过期）")
    return target


def resolved_link_path(document: dict, link: Any) -> str | None:
    try:
        return resolve_native_target(document, link.object_id, link.point_id, link.path).path
    except ValueError:
        return None


# 读侧「无法定位的旧关联」原因码（稳定码；前端本地化，不解析后端的自由文案）。
UNRESOLVED_OBJECT_ID_INVALID = "object_id_invalid"
UNRESOLVED_NO_LOCATOR = "no_locator"
UNRESOLVED_TARGET_MISSING = "target_missing"


def unresolved_link_reason(link: Any) -> str:
    """调用方已确认这条关联解析不到（resolved_link_path 返回 None）时的原因码。

    不在这里回头猜目标：只是把「为什么定位不到」分成三种可解释的情况。
    """
    object_id = getattr(link, "object_id", None)
    path = getattr(link, "path", None)
    if object_id is not None and not is_object_id(object_id):
        return UNRESOLVED_OBJECT_ID_INVALID
    if object_id is None and not path:
        return UNRESOLVED_NO_LOCATOR
    return UNRESOLVED_TARGET_MISSING
