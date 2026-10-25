# SPDX-License-Identifier: Apache-2.0
"""W06 条目级正文锁（``lock_content``）的校验与锁标记回填。

从 fact_locks.py 拆出（生产文件行数预算）：事实锁与正文锁虽然共用 409 + violations
形状，但判定对象不同——

- **事实锁**锁的是"某个位置的值"（姓名/机构/时间/数字/职责边界），按 object_id 解析
  当前位置再逐字比对；
- **正文锁**锁的是"整条正文"（条目里的 ``lock_content=true``），只允许调排版/隐藏，
  正文载荷变了或被删就拒绝。

本模块只做纯内存比对，不碰数据库；``FactLockViolation`` 也归这里（事实锁侧 re-export
保持既有 import 路径不变）。``fact_locks.enforce_ai_content`` 是两者唯一的落库前闸门。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .document_identity import ENTRY_FIELDS, is_object_id, resolve_object_path

# W06 条目级正文锁。没有独立的锁表：锁就是条目里的 lock_content 布尔字段。
LOCK_CONTENT_KIND = "lock_content"
LOCK_CONTENT_CHANGED_REASON = "锁定条目正文被改动"
LOCK_CONTENT_MISSING_REASON = "锁定条目在本次修改后已不存在"
# 这些键不是"正文"：排版/隐藏/身份/锁标记本身允许变化（锁正文不锁排版）。
_ENTRY_NON_CONTENT_KEYS = frozenset({"id", "point_ids", "hidden", "lock_content", "lock_layout"})


@dataclass(frozen=True)
class FactLockViolation:
    """一条锁违规（事实锁与正文锁共用；lock_id=0 表示不是行级事实锁）。"""

    lock_id: int
    kind: str
    label: str
    path: str
    field: str
    reason: str
    locked_value: str
    current_value: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "lock_id": self.lock_id,
            "kind": self.kind,
            "label": self.label,
            "path": self.path,
            "field": self.field,
            "reason": self.reason,
            "locked_value": self.locked_value,
            "current_value": self.current_value,
        }


def _entry_content_payload(entry: dict[str, Any]) -> str:
    """条目正文载荷：去掉身份/可见性/锁标记后的规范化 JSON（用于比对是否改了正文）。"""
    payload = {key: value for key, value in entry.items() if key not in _ENTRY_NON_CONTENT_KEYS}
    try:
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):  # pragma: no cover - content 来自 JSON 列，正常可序列化
        return repr(payload)


def entry_content_payload(entry: dict[str, Any]) -> str:
    """公开的条目正文载荷（翻译预览等调用方判断"这条正文是否被改"）。"""
    return _entry_content_payload(entry)


def _entry_label(entry: dict[str, Any]) -> str:
    for key in ("company", "school", "organization", "title", "name", "role", "position"):
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:60]
    return ""


def _locate_locked_entry(
    new_entries: list[Any], old_entry: dict[str, Any], old_index: int
) -> tuple[dict[str, Any] | None, int]:
    """在当前（新）正文里定位被锁条目：优先按 object_id，回退同栏目同下标。"""
    object_id = old_entry.get("id")
    if is_object_id(object_id):
        for index, entry in enumerate(new_entries):
            if isinstance(entry, dict) and entry.get("id") == object_id:
                return entry, index
    if 0 <= old_index < len(new_entries) and isinstance(new_entries[old_index], dict):
        candidate = new_entries[old_index]
        # 两边都有合法 id 却不同 = 同下标已经是另一个对象，不能拿它当"锁定条目"。
        other_id = candidate.get("id")
        if not is_object_id(object_id) or not is_object_id(other_id) or other_id == object_id:
            return candidate, old_index
    return None, old_index


def validate_content_locks_for(
    old_content: dict[str, Any] | None, content: dict[str, Any]
) -> list[FactLockViolation]:
    """W06 ``lock_content``：锁定条目只允许调排版/隐藏，正文变了（或被删）即违规。

    纯内存比对：旧正文由调用方给（当前简历是 record.content，翻译采纳是变体旧内容），
    新正文是准备写入的那一份。**基准必须与写入对象一致**——用 record.content 当变体
    译文采纳的基准会把"变体本来就和母版不同"误判成改锁。
    """
    old_payload = old_content if isinstance(old_content, dict) else {}
    violations: list[FactLockViolation] = []
    for field in ENTRY_FIELDS:
        old_entries = old_payload.get(field) or []
        if not isinstance(old_entries, list):
            continue
        new_entries = content.get(field) or []
        if not isinstance(new_entries, list):
            new_entries = []
        for old_index, old_entry in enumerate(old_entries):
            if not isinstance(old_entry, dict) or not old_entry.get("lock_content"):
                continue
            label = _entry_label(old_entry)
            new_entry, new_index = _locate_locked_entry(new_entries, old_entry, old_index)
            if new_entry is None:
                violations.append(
                    FactLockViolation(
                        lock_id=0,
                        kind=LOCK_CONTENT_KIND,
                        label=label,
                        path=f"{field}.{old_index}",
                        field="content",
                        reason=LOCK_CONTENT_MISSING_REASON,
                        locked_value="",
                        current_value="",
                    )
                )
                continue
            if _entry_content_payload(old_entry) != _entry_content_payload(new_entry):
                object_id = new_entry.get("id")
                resolved = (
                    resolve_object_path(content, object_id) if is_object_id(object_id) else None
                )
                violations.append(
                    FactLockViolation(
                        lock_id=0,
                        kind=LOCK_CONTENT_KIND,
                        label=label,
                        path=resolved or f"{field}.{new_index}",
                        field="content",
                        reason=LOCK_CONTENT_CHANGED_REASON,
                        locked_value="",
                        current_value="",
                    )
                )
    return violations


def validate_content_locks(record: Any, content: dict[str, Any]) -> list[FactLockViolation]:
    """``record.content`` 作为旧正文的便捷入口（保持既有调用方/测试的签名）。"""
    return validate_content_locks_for(getattr(record, "content", None) or {}, content)


def changed_locked_entry_paths(
    old_content: dict[str, Any] | None, content: dict[str, Any]
) -> list[str]:
    """返回"变了的锁定条目"的路径（翻译候选预览用：据此回填原文，不展示改锁结果）。"""
    return [item.path for item in validate_content_locks_for(old_content, content)]


def restore_lock_flags(old_content: dict[str, Any], content: dict[str, Any]) -> None:
    """把旧正文里的 lock_content/lock_layout 标记带回新正文（按身份，回退同下标）。

    为什么必须由服务端做：锁标记是**服务端状态**，不是模型可回显的内容；模型输出通常
    不带 id/锁字段，若原样落库就等于"AI 一改写，锁自动消失"。这里只补标记，不改正文。
    """
    for field in ENTRY_FIELDS:
        old_entries = old_content.get(field) or []
        new_entries = content.get(field)
        if not isinstance(old_entries, list) or not isinstance(new_entries, list):
            continue
        for index, old_entry in enumerate(old_entries):
            if not isinstance(old_entry, dict):
                continue
            flags = [key for key in ("lock_content", "lock_layout") if old_entry.get(key)]
            if not flags:
                continue
            target: dict[str, Any] | None = None
            object_id = old_entry.get("id")
            if is_object_id(object_id):
                target = next(
                    (
                        entry
                        for entry in new_entries
                        if isinstance(entry, dict) and entry.get("id") == object_id
                    ),
                    None,
                )
            if target is None and 0 <= index < len(new_entries):
                candidate = new_entries[index]
                if isinstance(candidate, dict):
                    target = candidate
            if target is None:
                continue
            for key in flags:
                target[key] = True


__all__ = [
    "FactLockViolation",
    "LOCK_CONTENT_CHANGED_REASON",
    "LOCK_CONTENT_KIND",
    "LOCK_CONTENT_MISSING_REASON",
    "changed_locked_entry_paths",
    "entry_content_payload",
    "restore_lock_flags",
    "validate_content_locks",
    "validate_content_locks_for",
]
