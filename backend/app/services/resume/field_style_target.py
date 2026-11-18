# SPDX-License-Identifier: Apache-2.0
"""字段级排版的路径校验：只有"像路径"的键才允许进 format_config 或 CSS 选择器。

为什么要白名单：字段路径会同时变成 ``object_roles`` 的键和 CSS 属性选择器
（``[data-resume-path="..."]``）——不校验等于把用户可写的数据拼进选择器。正则限定
"字母开头 + 1~4 段、每段 8~32 位"：段长下限对齐 id 生成器的实际形态，上限防超长键。

:func:`content_field_paths` 再收一层：只保留**当前文档里真的还能解析到**的 item/point
路径。删掉的字段留下的样式不会再被当成有效覆盖，也不会写进 CSS。
"""

from __future__ import annotations

import re
from typing import TypeGuard

# 段长 8~32 是 item/point id 的实际形态；用 fullmatch 而不是 search，避免子串绕过。
_FIELD_PATH = re.compile(
    r"^[A-Za-z][A-Za-z0-9_-]{0,63}\.[A-Za-z0-9_-]{8,32}"
    r"\.[A-Za-z0-9_-]{8,32}(?:\.[A-Za-z0-9_-]{8,32})?$"
)

# 页眉字段是**两段**路径（`header.{item_id}`，见 `document/paths.ts`）：它没有条目，
# 所以不能套上面那条三段规则。单开一条规则而不是把段数下限改成 2——后者等于放宽所有
# 两段路径，`header` 之外的任意 `a.b` 都会进白名单。
_HEADER_PATH = re.compile(r"^header\.[A-Za-z0-9_-]{8,32}$")


def is_header_path(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and bool(_HEADER_PATH.fullmatch(value))


def is_field_path(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and bool(
        _FIELD_PATH.fullmatch(value) or _HEADER_PATH.fullmatch(value)
    )


def field_entry_id(value: str | None) -> str | None:
    """字段路径 → 所属条目 id；页眉字段没有条目（返回 None，不做上一级回落）。"""
    if value is None or is_header_path(value):
        return None
    return value.split(".")[1] if is_field_path(value) else None


def content_field_paths(content: dict | None) -> set[str]:
    """Keep only paths that still resolve to a stored v2 item, point, or header field."""
    found: set[str] = set()
    if not isinstance(content, dict) or content.get("version") != 2:
        return found
    # 页眉字段：`plan_header` 给标签段与值段都挂 `header.{id}`，只遍历 sections 会把它们
    # 当成"失效路径"在保存时剪掉（样式静默消失）。
    header = content.get("header")
    if isinstance(header, dict):
        for item in header.get("items") or []:
            if not isinstance(item, dict):
                continue
            path = f"header.{item.get('id')}"
            if is_field_path(path):
                found.add(path)
    for section in content.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for entry in section.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            for item in entry.get("items") or []:
                if not isinstance(item, dict):
                    continue
                path = f"{section.get('key')}.{entry.get('id')}.{item.get('id')}"
                if not is_field_path(path):
                    continue
                found.add(path)
                for point in item.get("points") or []:
                    point_path = f"{path}.{point.get('id')}" if isinstance(point, dict) else ""
                    if is_field_path(point_path):
                        found.add(point_path)
    return found
