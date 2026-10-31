# SPDX-License-Identifier: Apache-2.0
"""自定义小字段定义的写入/删除（从 definition_store.py 拆出：单文件 500 行预算）。

行为与错误契约完全沿用 definition_store：条件写（expected_revision）、软删保留值、
每分区 ≤20 个、默认字段受保护。definition_store 在文件末尾 re-export 本模块的四个
函数，外部 import 路径不变。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_definition import ProfileCustomField
from . import field_placement, value_validation, workspace_bootstrap
from .definition_store import (
    _ATOMIC_FAILED,  # noqa: F401 - re-export 方便测试/调用方读同一文案
    _BUILTIN_FIELD_IDS,
    _FIELD_MISSING,
    _MAX_CUSTOM_FIELDS,
    _UNSET,
    _atomic,
    _conditional_update,
    _entry_counts,
    _impact,
    _prepare_field_change,
    _require_active_section,
    _require_state_revision,
    _touch_state,
    _validate_field_label,
    _validated,
)
from .errors import Conflict, LimitReached, NotFound
from .field_preferences import (
    MergedField,
    active_custom_field,
    custom_field_rows,
    merged_custom_field,
)


@_atomic
def create_custom_field(
    db: Session,
    section_key: str,
    label: str,
    field_type: str,
    *,
    default_placement: str | None = None,
    material_only: bool = False,
    expected_revision: int | None = None,
) -> MergedField:
    """给任意活动分区（13 个内置或自建）新增自定义小字段（R-11）；每分区 ≤20 个。

    default_placement / material_only 是 v2 文档模型的纸面属性（0069）：缺省时保留
    NULL/False，等价于"按类型自动且上纸面"，旧客户端行为逐字节不变。
    """
    state = workspace_bootstrap.ensure_workspace(db)
    active_key = _require_active_section(db, section_key)
    _require_state_revision(state, expected_revision)
    clean_label, label_key = _validate_field_label(db, active_key, label)
    clean_type = _validated(value_validation.validate_field_type, field_type)
    active_rows = custom_field_rows(db, section_key=active_key)
    if len(active_rows) >= _MAX_CUSTOM_FIELDS:
        raise LimitReached(
            f"每个大字段最多只能添加 {_MAX_CUSTOM_FIELDS} 个自定义字段"
            f"（当前已有 {len(active_rows)} 个）：请先删除不用的字段后再试",
            code="limit_reached",
        )
    max_sort = (
        db.query(func.max(ProfileCustomField.sort_order))
        .filter(ProfileCustomField.section_key == active_key)
        .scalar()
    )
    row = ProfileCustomField(
        field_id=workspace_bootstrap.generate_external_id(db, ProfileCustomField, "field_id"),
        section_key=active_key,
        label=clean_label,
        label_key=label_key,
        field_type=clean_type,
        default_placement=field_placement.normalize_default_placement(
            clean_type, default_placement
        ),
        material_only=bool(material_only),
        sort_order=0 if max_sort is None else int(max_sort) + 1,
        revision=1,
    )
    db.add(row)
    _touch_state(db, state)
    db.commit()
    db.refresh(row)
    return merged_custom_field(db, row)


@_atomic
def update_custom_field(
    db: Session,
    section_key: str,
    field_id: str,
    *,
    label: str | None = None,
    sort_order: int | None = None,
    default_placement: Any = _UNSET,
    material_only: bool | None = None,
    expected_revision: int,
) -> MergedField:
    """改名/调整自建小字段顺序/纸面位置；默认字段只能隐藏（R-12）。

    default_placement 三态：没传 = 不改；传 None = 恢复"按类型自动"；传具体值 = 改到
    该位置。material_only 两态：None = 不改。
    """
    row, current = _prepare_field_change(db, section_key, field_id, expected_revision)
    updates: dict[str, Any] = {}
    if label is not None:
        clean_label, label_key = _validate_field_label(
            db, row.section_key, label, exclude_pk=int(row.id)
        )
        updates["label"] = clean_label
        updates["label_key"] = label_key
    if sort_order is not None:
        updates["sort_order"] = int(sort_order)
    if default_placement is not _UNSET:
        requested = default_placement if isinstance(default_placement, str) else None
        updates["default_placement"] = field_placement.normalize_default_placement(
            row.field_type, requested
        )
    if material_only is not None:
        updates["material_only"] = bool(material_only)
    if not updates:
        return merged_custom_field(db, row)
    _conditional_update(db, ProfileCustomField, int(row.id), current, updates)
    _touch_state(db, workspace_bootstrap.ensure_workspace(db))
    db.commit()
    db.refresh(row)
    return merged_custom_field(db, row)


@_atomic
def delete_custom_field(
    db: Session,
    section_key: str,
    field_id: str,
    *,
    expected_revision: int,
    confirm_with_values: bool = False,
) -> dict[str, Any]:
    """软删自定义字段：值保留在条目 JSON；含值且未确认 → 409 field_has_values。"""
    state = workspace_bootstrap.ensure_workspace(db)
    row, current = _prepare_field_change(db, section_key, field_id, expected_revision)
    affected = _entry_counts(db, row.section_key, row.field_id)["affected_entries"]
    if affected and not confirm_with_values:
        raise Conflict(
            f"已有 {affected} 条记录填写了这个字段，删除后它们不再显示但值会保留："
            "请确认后重试（可先导出备份）",
            code="field_has_values",
            affected_entries=affected,
        )
    _conditional_update(db, ProfileCustomField, int(row.id), current, {"deleted_at": utcnow()})
    _touch_state(db, state)
    db.commit()
    return _impact(current + 1, affected_entries=affected)


def field_deletion_impact(db: Session, section_key: str, field_id: str) -> dict[str, Any]:
    """删除前影响面：多少条记录已填写、恢复位置、当前 revision（R-14）。"""
    section = str(section_key or "").strip()
    field_key = str(field_id or "").strip()
    affected = _entry_counts(db, section, field_key)["affected_entries"]
    if field_key in _BUILTIN_FIELD_IDS:
        return _impact(0, can_delete=False, affected_entries=affected)
    row = active_custom_field(db, section, field_key)
    if row is None:
        raise NotFound(_FIELD_MISSING)
    return _impact(int(row.revision or 1), affected_entries=affected)


__all__ = [
    "create_custom_field",
    "delete_custom_field",
    "field_deletion_impact",
    "update_custom_field",
]
