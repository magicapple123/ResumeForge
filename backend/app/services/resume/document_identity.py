# SPDX-License-Identifier: Apache-2.0
"""简历文档的对象身份（W01）：条目与要点的稳定标识。

为什么需要它：加粗覆盖、事实来源标注、局部排版规则、批注都以"哪一条"为锚点，而
``experience.0.description.1`` 是**下标**——把第二个项目拖到第一位，这条路径指向的
就变成了别人。下标适合临时定位，不适合持久关系。

设计取舍（见 ``deliverables/…-W00-baseline-and-contracts.md`` §3）：

- **可选 + 伴随映射**，不把 ``list[str]`` 改成对象数组：后者要同时改 HTML/PDF/Word/
  Markdown 四个渲染器与表单，属于"整套引擎替换"，被计划排除。
- **读旧记录不物化**：``GET`` 原样返回（没有 id 就是没有），只在**保存**时把客户端
  带上来的 id 原样落库。这样不会出现"只是打开看了一眼，数据库就变了"。
- **写侧严格、读侧宽容**：非法 id 在保存时 422 拒写（静默重生成等于把用户设备上的
  标识悄悄换掉）；AI 改写这种"没有可回 422 的客户端"的路径改为丢弃非法 id。

本模块只做纯校验与内存定位，不碰数据库、不 import 路由。
"""

from __future__ import annotations

import copy
import re
from typing import Any

# 8–32 位：够短（URL/JSON 友好）、够长（随机碰撞概率可忽略）。
OBJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,32}$")

# 单份文档的 id 上限。6 类条目各 200、要点各 500 的组合在理论上远超这个数，
# 2000 是"正常简历永远够用、异常输入尽早被拒"的折中。
MAX_OBJECT_IDS_PER_DOCUMENT = 2000

# 每类条目声明的要点数组字段名。**只允许这些 key**：否则任意 JSON 都能塞进 content。
POINT_FIELDS: dict[str, tuple[str, ...]] = {
    "education": ("courses", "achievements"),
    "experience": ("description",),
    "campus_experience": ("description",),
    "projects": ("tech_stack", "description", "highlights"),
    # W14 科研三栏目（稳定 id 与可见性过滤自动继承同一套规则）
    "publications": (),
    "research_projects": ("description", "outcomes"),
    "patents": (),
    "skills": (),
    "awards": (),
}

ENTRY_FIELDS: tuple[str, ...] = tuple(POINT_FIELDS)


class DocumentIdentityError(ValueError):
    """对象标识不合法。路由把它翻成 422，不做静默修复。"""


def is_object_id(value: object) -> bool:
    return isinstance(value, str) and bool(OBJECT_ID_PATTERN.fullmatch(value))


def _entry_ids(entry: dict[str, Any], field: str, index: int) -> list[str]:
    """校验一条条目并返回它携带的全部 id（条目 id + 要点 id）。"""
    found: list[str] = []
    object_id = entry.get("id")
    if object_id is not None:
        if not is_object_id(object_id):
            raise DocumentIdentityError(f"{field}[{index}] 的对象标识不合法")
        found.append(object_id)

    point_ids = entry.get("point_ids")
    if point_ids is None:
        return found
    if not isinstance(point_ids, dict):
        raise DocumentIdentityError(f"{field}[{index}] 的要点标识必须是映射")
    allowed = POINT_FIELDS[field]
    unknown = sorted(set(point_ids) - set(allowed))
    if unknown:
        raise DocumentIdentityError(f"{field}[{index}] 含未知要点字段：{', '.join(unknown)}")
    for key, values in point_ids.items():
        source = entry.get(key)
        if not isinstance(values, list):
            raise DocumentIdentityError(f"{field}[{index}].{key} 的要点标识必须是数组")
        if not isinstance(source, list) or len(values) != len(source):
            # 长度不等的唯一解释是客户端拼错；按位置回填必然错位。
            raise DocumentIdentityError(f"{field}[{index}].{key} 的要点标识数量与内容不一致")
        for value in values:
            if not is_object_id(value):
                raise DocumentIdentityError(f"{field}[{index}].{key} 的要点标识不合法")
            found.append(value)
    return found


def validate_document_ids(content: dict[str, Any] | None) -> None:
    """保存前校验整份 content；不合法抛 :class:`DocumentIdentityError`。

    规则：字符集 8–32 位、同一数组内唯一、``point_ids`` 与该字段等长、key 只允许
    该模型声明的字段、单份文档 id 总数 ≤ 2000。
    """
    if content is None:
        return
    if not isinstance(content, dict):
        raise DocumentIdentityError("简历内容必须是对象")
    total = 0
    for field in ENTRY_FIELDS:
        entries = content.get(field) or []
        if not isinstance(entries, list):
            raise DocumentIdentityError(f"{field} 必须是数组")
        seen: list[str] = []
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise DocumentIdentityError(f"{field}[{index}] 必须是对象")
            found = _entry_ids(entry, field, index)
            total += len(found)
            # 同一数组内重复（跨数组允许：它们是不同的对象族）。
            for value in found:
                if value in seen:
                    raise DocumentIdentityError(f"{field} 内存在重复的对象标识")
                seen.append(value)
    if total > MAX_OBJECT_IDS_PER_DOCUMENT:
        raise DocumentIdentityError(f"对象标识数量超过上限（{MAX_OBJECT_IDS_PER_DOCUMENT}）")


def _sanitize_entry(entry: dict[str, Any], field: str) -> None:
    if not is_object_id(entry.get("id")):
        entry.pop("id", None)
    point_ids = entry.get("point_ids")
    if not isinstance(point_ids, dict):
        entry.pop("point_ids", None)
        return
    cleaned: dict[str, list[str]] = {}
    for key, values in point_ids.items():
        source = entry.get(key)
        if key not in POINT_FIELDS[field] or not isinstance(values, list):
            continue
        if not isinstance(source, list) or len(values) != len(source):
            continue
        if all(is_object_id(value) for value in values):
            cleaned[key] = list(values)
    if cleaned:
        entry["point_ids"] = cleaned
    else:
        entry.pop("point_ids", None)


def sanitize_document_ids(content: dict[str, Any] | None) -> dict[str, Any] | None:
    """丢弃不合法的 id，保留其余内容（供 AI 改写这类无法 422 的路径使用）。"""
    if not isinstance(content, dict):
        return content
    cleaned = copy.deepcopy(content)
    for field in ENTRY_FIELDS:
        for entry in cleaned.get(field) or []:
            if isinstance(entry, dict):
                _sanitize_entry(entry, field)
    return cleaned


def resolve_object_path(content: dict[str, Any] | None, object_id: str) -> str | None:
    """按条目 id 找它**当前**的下标路径；找不到返回 ``None``。

    只做内存定位：``content`` 是 JSON 列，无法按 id 建索引（见 W00 §6 R3）。
    """
    if not isinstance(content, dict) or not is_object_id(object_id):
        return None
    for field in ENTRY_FIELDS:
        for index, entry in enumerate(content.get(field) or []):
            if isinstance(entry, dict) and entry.get("id") == object_id:
                return f"{field}.{index}"
    return None


def resolve_point_path(content: dict[str, Any] | None, object_id: str, point_id: str) -> str | None:
    """按条目 id + 要点 id 找 ``field.index.key.point_index``；找不到返回 ``None``。"""
    entry_path = resolve_object_path(content, object_id)
    if entry_path is None:
        return None
    field, _, index_text = entry_path.partition(".")
    entry = (content or {}).get(field, [])[int(index_text)]
    point_ids = entry.get("point_ids") or {}
    for key, values in point_ids.items():
        if point_id in values:
            return f"{entry_path}.{key}.{values.index(point_id)}"
    return None


__all__ = [
    "DocumentIdentityError",
    "ENTRY_FIELDS",
    "MAX_OBJECT_IDS_PER_DOCUMENT",
    "OBJECT_ID_PATTERN",
    "POINT_FIELDS",
    "is_object_id",
    "resolve_object_path",
    "resolve_point_path",
    "sanitize_document_ids",
    "validate_document_ids",
]
