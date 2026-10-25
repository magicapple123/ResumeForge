# SPDX-License-Identifier: Apache-2.0
"""大字段/小字段定义的写入与删除（契约 §4 definition_store）。

内置定义来自 definition_catalog（只读），自建定义落在 profile_custom_section /
profile_custom_field；合并编辑视图在 field_preferences（MergedSection/MergedField 也在
那里定义，本模块按契约再导出）。用户可在**任何分区**（含 13 个内置）新增自定义小字段
（R-11），默认字段只能隐藏（builtin_field_protected）。

删除定义只软删、不删条目与值（R-06/R-13），同名重建是新 id；改名/删除/排序带
expected_revision，定义变更同步推进 workspace state.revision，让其它窗口拿到 409 而不是
安静地用旧定义。
"""

from __future__ import annotations

from functools import wraps
from typing import Any, cast

from sqlalchemy import func, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_definition import ProfileCustomField, ProfileCustomSection
from ...models.profile_entry import ProfileEntry
from ...models.profile_group import ProfileGroupMember
from . import value_validation, workspace_bootstrap
from .definition_catalog import (
    BUILTIN_SECTION_NAMES,
    BUILTIN_SECTIONS,
    SECTION_BY_KEY,
)
from .errors import Conflict, LimitReached, NotFound, RevisionConflict, ValidationError
from .field_preferences import (
    MergedField,
    MergedSection,
    active_custom_field,
    active_custom_section,
    build_section,
    build_sections,
    custom_field_rows,
    merged_custom_field,
    merged_custom_section,
)

_norm = value_validation.normalize_name_key
_BUILTIN_NAME_KEYS = frozenset(_norm(name) for name in BUILTIN_SECTION_NAMES)
_BUILTIN_FIELD_IDS = frozenset(
    field.field_id for section in BUILTIN_SECTIONS for field in section.fields
)
_MAX_CUSTOM_FIELDS = value_validation.MAX_CUSTOM_FIELDS_PER_SECTION
_BUILTIN_SECTION_PROTECTED = (
    "系统内置大字段不能改名或删除：只能调整它的顺序，或在其中新增自定义小字段"
)
_BUILTIN_FIELD_PROTECTED = "系统内置的默认字段不能改名或删除：只能隐藏它（隐藏后可随时恢复显示）"
_SECTION_MISSING = "大字段不存在或已删除：请刷新页面后重试"
_FIELD_MISSING = "自定义字段不存在或已删除：请刷新页面后重试"
_ATOMIC_FAILED = "保存失败：内容可能刚被其他窗口修改或名称已被占用，请刷新页面后重试"


def _atomic(func: Any) -> Any:
    """事务边界统一收口：IntegrityError 翻译成 409，其余异常回滚后原样抛。"""

    @wraps(func)
    def wrapper(db: Session, *args: Any, **kwargs: Any) -> Any:
        try:
            return func(db, *args, **kwargs)
        except IntegrityError as exc:
            db.rollback()
            raise Conflict(_ATOMIC_FAILED, code="conflict") from exc
        except Exception:
            db.rollback()
            raise

    return wrapper


def _validated(validator: Any, raw: Any) -> Any:
    try:
        return validator(raw)
    except value_validation.ValidationFailure as failure:
        raise ValidationError(failure.detail, code=failure.code) from failure


def _row_revision(db: Session, model: Any, pk: int) -> int:
    value = db.query(model.revision).filter(model.id == pk).scalar()
    return int(value or 0)


def _conditional_update(
    db: Session, model: Any, pk: int, current: int, values: dict[str, Any]
) -> None:
    """条件写（WHERE id AND revision AND deleted_at IS NULL）；rowcount=0 → 409。"""
    # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(model)
            .where(model.id == pk, model.revision == current, model.deleted_at.is_(None))
            .values(**values, revision=current + 1, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        ),
    )
    if result.rowcount != 1:
        db.rollback()
        raise RevisionConflict(_row_revision(db, model, pk))


def _default_label_keys(section_key: str) -> set[str]:
    spec = SECTION_BY_KEY.get(section_key)
    return {_norm(field.label) for field in spec.fields} if spec is not None else set()


def _entry_counts(db: Session, section_key: str, field_id: str | None = None) -> dict[str, int]:
    entries = (
        db.query(ProfileEntry)
        .filter(ProfileEntry.section_key == section_key, ProfileEntry.deleted_at.is_(None))
        .all()
    )
    filled = affected = 0
    for entry in entries:
        values = entry.values if isinstance(entry.values, dict) else {}
        if any(str(value or "").strip() for value in values.values()):
            filled += 1
        if field_id is not None and str(values.get(field_id) or "").strip():
            affected += 1
    return {
        "entry_count": len(entries),
        "filled_entry_count": filled,
        "affected_entries": affected,
    }


def _impact(revision: int, *, can_delete: bool = True, **extra: Any) -> dict[str, Any]:
    return {
        **extra,
        "can_delete": can_delete,
        "restore_path": "回收站",
        "revision": revision,
    }


def _require_active_section(db: Session, section_key: str) -> str:
    key = str(section_key or "").strip()
    if key in SECTION_BY_KEY or active_custom_section(db, key) is not None:
        return key
    raise ValidationError(
        f"大字段「{key or '空'}」不存在或已删除：请刷新页面后重新选择",
        code="section_not_found",
    )


def _validate_section_name(
    db: Session, name: str, *, exclude_pk: int | None = None
) -> tuple[str, str]:
    clean = _validated(value_validation.validate_section_name, name)
    name_key = _norm(clean)
    if name_key in _BUILTIN_NAME_KEYS:
        raise ValidationError(
            f"大字段名称「{clean}」与系统内置大字段重名：请换一个名称后重试",
            code="section_name_duplicate",
        )
    query = db.query(ProfileCustomSection).filter(
        ProfileCustomSection.deleted_at.is_(None),
        ProfileCustomSection.name_key == name_key,
    )
    if exclude_pk is not None:
        query = query.filter(ProfileCustomSection.id != exclude_pk)
    duplicate = query.first()
    if duplicate is not None:
        raise ValidationError(
            f"已有同名大字段「{duplicate.name}」：请换一个名称后重试",
            code="section_name_duplicate",
        )
    return clean, name_key


def _validate_field_label(
    db: Session, section_key: str, label: str, *, exclude_pk: int | None = None
) -> tuple[str, str]:
    clean = _validated(value_validation.validate_field_label, label)
    label_key = _norm(clean)
    if label_key in _default_label_keys(section_key):
        raise ValidationError(
            f"字段名称「{clean}」与该大字段的默认字段重名：请换一个名称后重试",
            code="field_label_duplicate",
        )
    query = db.query(ProfileCustomField).filter(
        ProfileCustomField.section_key == section_key,
        ProfileCustomField.deleted_at.is_(None),
        ProfileCustomField.label_key == label_key,
    )
    if exclude_pk is not None:
        query = query.filter(ProfileCustomField.id != exclude_pk)
    duplicate = query.first()
    if duplicate is not None:
        raise ValidationError(
            f"该大字段下已有同名字段「{duplicate.label}」：请换一个名称后重试",
            code="field_label_duplicate",
        )
    return clean, label_key


def _require_state_revision(state: Any, expected_revision: int | None) -> None:
    current = int(state.revision or 1)
    if expected_revision is not None and int(expected_revision) != current:
        raise RevisionConflict(current)


def _prepare_section_change(
    db: Session, key: str, expected_revision: int
) -> tuple[ProfileCustomSection, int]:
    section_key = str(key or "").strip()
    if section_key in SECTION_BY_KEY:
        raise ValidationError(_BUILTIN_SECTION_PROTECTED, code="builtin_protected")
    row = active_custom_section(db, section_key)
    if row is None:
        raise NotFound(_SECTION_MISSING)
    current = int(row.revision or 1)
    if int(expected_revision) != current:
        raise RevisionConflict(current)
    return row, current


def _prepare_field_change(
    db: Session, section_key: str, field_id: str, expected_revision: int
) -> tuple[ProfileCustomField, int]:
    section = str(section_key or "").strip()
    field_key = str(field_id or "").strip()
    if field_key in _BUILTIN_FIELD_IDS:
        raise ValidationError(_BUILTIN_FIELD_PROTECTED, code="builtin_field_protected")
    row = active_custom_field(db, section, field_key)
    if row is None:
        raise NotFound(_FIELD_MISSING)
    current = int(row.revision or 1)
    if int(expected_revision) != current:
        raise RevisionConflict(current)
    return row, current


def _touch_state(db: Session, state: Any, *, section_order: list[str] | None = None) -> None:
    if section_order is not None:
        state.section_order = section_order
    state.revision = int(state.revision or 1) + 1
    state.updated_at = utcnow()


def list_sections(db: Session, *, include_deleted_fields: bool = False) -> list[MergedSection]:
    """编辑视图里的全部活动分区（合并视图见 field_preferences.build_sections）。"""
    return build_sections(db, include_deleted_fields=include_deleted_fields)


def get_section(db: Session, key: str, *, include_deleted: bool = False) -> MergedSection | None:
    """按 key 取一个分区（编辑 DTO）；不存在返回 None。"""
    return build_section(db, key, include_deleted=include_deleted)


@_atomic
def create_custom_section(
    db: Session, name: str, *, expected_state_revision: int | None = None
) -> MergedSection:
    """新建自建大字段；同一事务把它加入当前组并追加到全局顺序末尾（R-04/R-08）。"""
    state = workspace_bootstrap.ensure_workspace(db)
    _require_state_revision(state, expected_state_revision)
    clean_name, name_key = _validate_section_name(db, name)
    max_sort = db.query(func.max(ProfileCustomSection.sort_order)).scalar()
    section_id = workspace_bootstrap.generate_external_id(db, ProfileCustomSection, "section_id")
    row = ProfileCustomSection(
        section_id=section_id,
        key=f"custom:{section_id}",
        name=clean_name,
        name_key=name_key,
        sort_order=0 if max_sort is None else int(max_sort) + 1,
        revision=1,
    )
    db.add(row)
    db.flush()
    group = workspace_bootstrap.current_group(db, state)
    if group is not None:
        db.add(ProfileGroupMember(group_id=group.group_id, section_key=row.key))
        group.revision = int(group.revision or 1) + 1
        group.updated_at = utcnow()
    order = [str(key) for key in (state.section_order or [])]
    if row.key not in order:
        order.append(row.key)
    _touch_state(db, state, section_order=order)
    db.commit()
    db.refresh(row)
    return merged_custom_section(db, row)


@_atomic
def rename_custom_section(
    db: Session, key: str, name: str, *, expected_revision: int
) -> MergedSection:
    """改名（内置分区拒改）；条件写成功后返回最新编辑 DTO。"""
    row, current = _prepare_section_change(db, key, expected_revision)
    clean_name, name_key = _validate_section_name(db, name, exclude_pk=int(row.id))
    _conditional_update(
        db,
        ProfileCustomSection,
        int(row.id),
        current,
        {"name": clean_name, "name_key": name_key},
    )
    _touch_state(db, workspace_bootstrap.ensure_workspace(db))
    db.commit()
    db.refresh(row)
    return merged_custom_section(db, row)


@_atomic
def delete_custom_section(db: Session, key: str, *, expected_revision: int) -> dict[str, Any]:
    """软删自建大字段：条目/值/组关系都保留，只从编辑视图与全局顺序里下线（R-06）。"""
    state = workspace_bootstrap.ensure_workspace(db)
    row, current = _prepare_section_change(db, key, expected_revision)
    counts = _entry_counts(db, row.key)
    _conditional_update(db, ProfileCustomSection, int(row.id), current, {"deleted_at": utcnow()})
    order = [str(item) for item in (state.section_order or []) if str(item) != row.key]
    _touch_state(db, state, section_order=order)
    db.commit()
    return _impact(
        current + 1,
        entry_count=counts["entry_count"],
        filled_entry_count=counts["filled_entry_count"],
    )


def section_deletion_impact(db: Session, key: str) -> dict[str, Any]:
    """删除前影响面；内置分区不可删除（can_delete=False），自定义分区给出条数与 revision。"""
    section_key = str(key or "").strip()
    if section_key in SECTION_BY_KEY:
        counts = _entry_counts(db, section_key)
        return _impact(
            0,
            can_delete=False,
            entry_count=counts["entry_count"],
            filled_entry_count=counts["filled_entry_count"],
        )
    row = active_custom_section(db, section_key)
    if row is None:
        raise NotFound(_SECTION_MISSING)
    counts = _entry_counts(db, section_key)
    return _impact(
        int(row.revision or 1),
        entry_count=counts["entry_count"],
        filled_entry_count=counts["filled_entry_count"],
    )


@_atomic
def create_custom_field(
    db: Session,
    section_key: str,
    label: str,
    field_type: str,
    *,
    expected_revision: int | None = None,
) -> MergedField:
    """给任意活动分区（13 个内置或自建）新增自定义小字段（R-11）；每分区 ≤20 个。"""
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
    expected_revision: int,
) -> MergedField:
    """改名/调整自建小字段顺序；默认字段只能隐藏（R-12）。"""
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


def ensure_section_order(db: Session) -> list[str]:
    """规范全局顺序（契约 §4：见 workspace_bootstrap.repair_section_order）。"""
    return workspace_bootstrap.repair_section_order(db)


__all__ = [
    "MergedField",
    "MergedSection",
    "create_custom_field",
    "create_custom_section",
    "delete_custom_field",
    "delete_custom_section",
    "ensure_section_order",
    "field_deletion_impact",
    "get_section",
    "list_sections",
    "rename_custom_section",
    "section_deletion_impact",
    "update_custom_field",
]
