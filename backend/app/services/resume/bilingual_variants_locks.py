# SPDX-License-Identifier: Apache-2.0
"""语言变体的**锁定回填**（从 ``bilingual_variants`` 拆出，只为守住 500 行预算）。

这两个函数都是"拿候选与变体旧内容比、把锁定条目整条回填"的纯数据操作，读写都在调用方
已经持有的对象上、不碰数据库连接以外的资源，所以拆出去不影响任何事务边界。

``_fact_lock_blocked`` 走 W12 的事实锁校验（需要 Session 读简历记录）；
``_restore_locked_entries`` 完全纯函数（只动传进来的 dict）。
"""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from . import document_io, fact_locks
from .content_locks import entry_content_payload
from .document_identity import ENTRY_FIELDS, is_object_id
from .document_view import iter_entries


def _fact_lock_blocked(db: Session, resume_id: int | None, candidate: dict[str, Any]) -> list[str]:
    record = db.get(ResumeRecord, resume_id) if resume_id else None
    if record is None:
        return []
    violations = fact_locks.validate_fact_locks(db, record, candidate)
    return [item.path for item in violations]


def _restore_locked_entries(variant_content: dict, candidate: dict[str, Any]) -> list[str]:
    """正文锁在候选里也不展示改动：锁定条目整条回填原文，并记入 blocked_fields。

    基准是**变体自己的旧内容**（候选与采纳都写变体），不能用当前简历的 lock 标记：
    变体是独立表达对象，母版的锁/未锁状态与它无关。
    """
    if candidate.get("version") == 2:
        old_document = document_io.ensure_document_version(variant_content)
        blocked: list[str] = []
        for key, old_entry in iter_entries(old_document):
            if not old_entry.get("lock_content"):
                continue
            target = next(
                (
                    entry
                    for section, entry in iter_entries(candidate)
                    if section == key and entry.get("id") == old_entry.get("id")
                ),
                None,
            )
            if target is None:
                blocked.append(f"{key}.{old_entry['id']}")
                continue
            if entry_content_payload(old_entry) != entry_content_payload(target):
                blocked.append(f"{key}.{old_entry['id']}")
            target.clear()
            target.update(copy.deepcopy(old_entry))
        return blocked
    old_content = variant_content or {}
    blocked: list[str] = []
    for field in ENTRY_FIELDS:
        old_entries = old_content.get(field) or []
        new_entries = candidate.get(field)
        if not isinstance(old_entries, list) or not isinstance(new_entries, list):
            continue
        for index, old_entry in enumerate(old_entries):
            if not isinstance(old_entry, dict) or not old_entry.get("lock_content"):
                continue
            target_index: int | None = None
            object_id = old_entry.get("id")
            if is_object_id(object_id):
                for candidate_index, entry in enumerate(new_entries):
                    if isinstance(entry, dict) and entry.get("id") == object_id:
                        target_index = candidate_index
                        break
            if target_index is None and index < len(new_entries):
                candidate_entry = new_entries[index]
                other_id = candidate_entry.get("id") if isinstance(candidate_entry, dict) else None
                same_object = not (
                    is_object_id(object_id) and is_object_id(other_id) and other_id != object_id
                )
                if same_object:
                    target_index = index
            if target_index is None:
                continue
            if entry_content_payload(old_entry) != entry_content_payload(new_entries[target_index]):
                blocked.append(f"{field}.{target_index}")
            new_entries[target_index] = copy.deepcopy(old_entry)
    return blocked


__all__ = ["_fact_lock_blocked", "_restore_locked_entries"]
