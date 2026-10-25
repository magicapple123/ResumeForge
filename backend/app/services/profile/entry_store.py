# SPDX-License-Identifier: Apache-2.0
"""资料条目与值的存储层（契约 §4 entry_store）：单例 upsert、合并保存、排序、软删。

单例分区（basic_info/summary）第二次写入必须更新同一条；多条分区新建 sort_order =
活动最大值 + 1，上限 200 条。合并保存 = {**旧值, **提交值}：未提交的键（隐藏字段、
已删除字段）保留旧值，只有显式 "" 才清空；提交值先过 value_validation（内置类型取目录、
自定义类型取 DB 定义）。field_snapshot 记录当前 values 里出现键的历史标签/类型。
批量保存单事务、任一失败全回滚；排序先移到临时正序号区再写目标序号，避开活动行
(section_key, sort_order) 的 partial unique 冲突，条目 id 不变。
"""

from __future__ import annotations

from functools import wraps
from typing import Any, cast

from sqlalchemy import func, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_entry import ProfileEntry
from . import value_validation, workspace_bootstrap
from .definition_catalog import SECTION_BY_KEY, is_singleton
from .errors import Conflict, LimitReached, NotFound, RevisionConflict, ValidationError
from .field_preferences import active_custom_section, custom_field_rows

_MAX_ENTRIES = value_validation.MAX_ENTRIES_PER_SECTION
_ENTRY_MISSING = "记录不存在或已删除：请刷新页面后重试"
_ATOMIC_FAILED = "保存失败：内容可能刚被其他窗口修改，请刷新页面后重试"


def _atomic(func: Any) -> Any:
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


def _require_active_section(db: Session, section_key: str) -> str:
    key = str(section_key or "").strip()
    if key in SECTION_BY_KEY or active_custom_section(db, key) is not None:
        return key
    raise NotFound(f"大字段「{key or '空'}」不存在或已删除：请刷新页面后重试")


def _field_types(db: Session, section_key: str) -> dict[str, str]:
    """该分区当前允许写入的字段类型：默认字段（目录）+ 活动自定义字段（DB）。"""
    types: dict[str, str] = {}
    spec = SECTION_BY_KEY.get(section_key)
    if spec is not None:
        types.update({field.field_id: field.field_type for field in spec.fields})
    for row in custom_field_rows(db, section_key=section_key):
        types[row.field_id] = row.field_type
    return types


def _validated_values(db: Session, section_key: str, values: dict[str, Any]) -> dict[str, str]:
    try:
        return value_validation.validate_values_with_types(
            section_key, values, _field_types(db, section_key)
        )
    except value_validation.ValidationFailure as failure:
        raise ValidationError(failure.detail, code=failure.code) from failure


def _field_snapshot(
    db: Session, section_key: str, previous: Any, values: dict[str, str]
) -> list[dict[str, str]]:
    """保存时同步历史快照：当前定义顺序在前，已删除字段沿用旧快照里的标签/类型。"""
    ordered: list[tuple[str, str, str]] = []
    spec = SECTION_BY_KEY.get(section_key)
    if spec is not None:
        ordered += [(f.field_id, f.label, f.field_type) for f in spec.fields]
    ordered += [
        (row.field_id, row.label, row.field_type)
        for row in custom_field_rows(db, section_key=section_key)
    ]
    snapshot: list[dict[str, str]] = []
    known: set[str] = set()
    for field_id, label, field_type in ordered:
        if field_id in values:
            snapshot.append({"field_id": field_id, "label": label, "field_type": field_type})
            known.add(field_id)
    for item in previous if isinstance(previous, list) else []:
        if not isinstance(item, dict):
            continue
        field_id = str(item.get("field_id") or "")
        if field_id and field_id not in known and field_id in values:
            snapshot.append(
                {
                    "field_id": field_id,
                    "label": str(item.get("label") or field_id),
                    "field_type": str(item.get("field_type") or "multi_line"),
                }
            )
            known.add(field_id)
    return snapshot


def _active_entry(db: Session, section_key: str, entry_id: str) -> ProfileEntry | None:
    return (
        db.query(ProfileEntry)
        .filter(
            ProfileEntry.section_key == section_key,
            ProfileEntry.entry_id == str(entry_id or "").strip(),
            ProfileEntry.deleted_at.is_(None),
        )
        .first()
    )


def _singleton_entry(db: Session, section_key: str) -> ProfileEntry | None:
    return (
        db.query(ProfileEntry)
        .filter(
            ProfileEntry.section_key == section_key,
            ProfileEntry.sort_order == 0,
            ProfileEntry.deleted_at.is_(None),
        )
        .first()
    )


def _active_count(db: Session, section_key: str) -> int:
    return (
        db.query(ProfileEntry)
        .filter(
            ProfileEntry.section_key == section_key,
            ProfileEntry.deleted_at.is_(None),
        )
        .count()
    )


def _next_sort_order(db: Session, section_key: str) -> int:
    max_order = (
        db.query(func.max(ProfileEntry.sort_order))
        .filter(
            ProfileEntry.section_key == section_key,
            ProfileEntry.deleted_at.is_(None),
        )
        .scalar()
    )
    return 0 if max_order is None else int(max_order) + 1


def _assert_sort_free(
    db: Session, section_key: str, sort_order: int, *, exclude_pk: int | None = None
) -> None:
    query = db.query(ProfileEntry).filter(
        ProfileEntry.section_key == section_key,
        ProfileEntry.sort_order == sort_order,
        ProfileEntry.deleted_at.is_(None),
    )
    if exclude_pk is not None:
        query = query.filter(ProfileEntry.id != exclude_pk)
    if query.first() is not None:
        raise ValidationError(
            f"第 {sort_order + 1} 位已有其他记录：请先调整排序后再保存",
            code="sort_order_conflict",
        )


def _row_revision(db: Session, pk: int) -> int:
    value = db.query(ProfileEntry.revision).filter(ProfileEntry.id == pk).scalar()
    return int(value or 0)


def _conditional_update(db: Session, pk: int, current: int, values: dict[str, Any]) -> None:
    # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(ProfileEntry)
            .where(
                ProfileEntry.id == pk,
                ProfileEntry.revision == current,
                ProfileEntry.deleted_at.is_(None),
            )
            .values(**values, revision=current + 1, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        ),
    )
    if result.rowcount != 1:
        db.rollback()
        raise RevisionConflict(_row_revision(db, pk))


def _create_entry(
    db: Session, section_key: str, submitted: dict[str, str], sort_order: int
) -> ProfileEntry:
    row = ProfileEntry(
        entry_id=workspace_bootstrap.generate_external_id(db, ProfileEntry, "entry_id"),
        section_key=section_key,
        sort_order=int(sort_order),
        values=dict(submitted),
        field_snapshot=_field_snapshot(db, section_key, [], submitted),
        revision=1,
    )
    db.add(row)
    db.flush()
    return row


def _update_entry(
    db: Session,
    row: ProfileEntry,
    *,
    submitted: dict[str, str] | None,
    sort_order: int | None,
    expected_revision: int | None,
) -> ProfileEntry:
    current = int(row.revision or 1)
    if expected_revision is not None and int(expected_revision) != current:
        raise RevisionConflict(current)
    old_values = row.values if isinstance(row.values, dict) else {}
    updates: dict[str, Any] = {}
    if submitted is not None:
        merged = {**old_values, **submitted}
        if merged != old_values:
            updates["values"] = merged
            updates["field_snapshot"] = _field_snapshot(
                db, row.section_key, row.field_snapshot, merged
            )
    if sort_order is not None and int(sort_order) != int(row.sort_order):
        target = int(sort_order)
        if target < 0:
            raise ValidationError("排序序号不能为负数：请刷新页面后重试", code="invalid_sort_order")
        if is_singleton(row.section_key) and target != 0:
            raise ValidationError(
                "基本信息与个人总结只能有一条记录，序号固定为 0：请刷新页面后重试",
                code="singleton_sort_order",
            )
        _assert_sort_free(db, row.section_key, target, exclude_pk=int(row.id))
        updates["sort_order"] = target
    if not updates:
        return row
    _conditional_update(db, int(row.id), current, updates)
    db.flush()
    db.refresh(row)
    return row


def _apply_upsert(
    db: Session,
    section_key: str,
    *,
    entry_id: str | None,
    values: dict[str, Any] | None,
    sort_order: int | None,
    expected_revision: int | None,
) -> ProfileEntry:
    submitted = None if values is None else _validated_values(db, section_key, values)
    if entry_id is not None:
        row = _active_entry(db, section_key, str(entry_id))
        if row is None:
            raise NotFound(_ENTRY_MISSING)
        return _update_entry(
            db,
            row,
            submitted=submitted,
            sort_order=sort_order,
            expected_revision=expected_revision,
        )
    if is_singleton(section_key):
        existing = _singleton_entry(db, section_key)
        if existing is not None:
            return _update_entry(
                db,
                existing,
                submitted=submitted,
                sort_order=None,
                expected_revision=expected_revision,
            )
        return _create_entry(db, section_key, submitted or {}, 0)
    count = _active_count(db, section_key)
    if count >= _MAX_ENTRIES:
        raise LimitReached(
            f"每个大字段最多只能有 {_MAX_ENTRIES} 条记录（当前已有 {count} 条）："
            "请先删除不用的记录后再添加"
        )
    target = _next_sort_order(db, section_key) if sort_order is None else int(sort_order)
    _assert_sort_free(db, section_key, target)
    return _create_entry(db, section_key, submitted or {}, target)


def list_entries(
    db: Session,
    *,
    section_key: str | None = None,
    include_deleted: bool = False,
    section_keys: set[str] | None = None,
) -> list[ProfileEntry]:
    """条目列表；默认只返回活动分区（内置 13 + 活动自建）的条目（§4）。"""
    if section_key is not None:
        keys = [str(section_key)]
    elif section_keys is not None:
        keys = [str(key) for key in section_keys]
    else:
        keys = workspace_bootstrap.active_section_keys(db)
    if not keys:
        return []
    query = db.query(ProfileEntry).filter(ProfileEntry.section_key.in_(keys))
    if not include_deleted:
        query = query.filter(ProfileEntry.deleted_at.is_(None))
    return query.order_by(
        ProfileEntry.section_key.asc(),
        ProfileEntry.sort_order.asc(),
        ProfileEntry.id.asc(),
    ).all()


def get_entry(
    db: Session,
    section_key: str,
    entry_id: str,
    *,
    include_deleted: bool = False,
) -> ProfileEntry | None:
    """按外部稳定 id 取一条条目；默认把回收站里的当作不存在。"""
    query = db.query(ProfileEntry).filter(
        ProfileEntry.section_key == str(section_key or "").strip(),
        ProfileEntry.entry_id == str(entry_id or "").strip(),
    )
    if not include_deleted:
        query = query.filter(ProfileEntry.deleted_at.is_(None))
    return query.first()


@_atomic
def upsert_entry(
    db: Session,
    section_key: str,
    *,
    entry_id: str | None = None,
    values: dict[str, Any] | None = None,
    sort_order: int | None = None,
    expected_revision: int | None = None,
) -> ProfileEntry:
    """新增或局部更新一个条目：单例分区自动更新同一条，多条分区追加到末尾。"""
    section = _require_active_section(db, section_key)
    row = _apply_upsert(
        db,
        section,
        entry_id=entry_id,
        values=values,
        sort_order=sort_order,
        expected_revision=expected_revision,
    )
    db.commit()
    db.refresh(row)
    return row


@_atomic
def bulk_save_entries(
    db: Session, items: list[dict[str, Any]], *, expected_workspace_revision: int | None = None
) -> list[ProfileEntry]:
    """单事务批量保存（任一失败全回滚）；workspace revision 不符 → 409。"""
    state = workspace_bootstrap.ensure_workspace(db)
    if expected_workspace_revision is not None and int(expected_workspace_revision) != int(
        state.revision or 1
    ):
        raise RevisionConflict(int(state.revision or 1))
    if not isinstance(items, list):
        raise ValidationError("批量保存内容必须是数组：请刷新页面后重试", code="invalid_bulk")
    saved: list[ProfileEntry] = []
    for item in items:
        if not isinstance(item, dict):
            raise ValidationError(
                "批量保存的每一项必须包含大字段与字段值：请刷新页面后重试",
                code="invalid_bulk",
            )
        section_key = str(item.get("section_key") or "").strip()
        if not section_key:
            raise ValidationError("批量保存缺少大字段 key：请刷新页面后重试", code="invalid_bulk")
        values = item.get("values")
        if values is not None and not isinstance(values, dict):
            raise ValidationError(
                "字段值必须是「字段 id → 文本」的对象：请刷新页面后重试",
                code="invalid_values",
            )
        saved.append(
            _apply_upsert(
                db,
                _require_active_section(db, section_key),
                entry_id=item.get("entry_id"),
                values=values,
                sort_order=None,
                expected_revision=item.get("expected_revision"),
            )
        )
    db.commit()
    for row in saved:
        db.refresh(row)
    return saved


@_atomic
def delete_entry(
    db: Session,
    section_key: str,
    entry_id: str,
    *,
    expected_revision: int | None = None,
) -> None:
    """软删条目：只写 deleted_at，可经回收站恢复（R-06）。"""
    section = str(section_key or "").strip()
    row = _active_entry(db, section, entry_id)
    if row is None:
        raise NotFound(_ENTRY_MISSING)
    current = int(row.revision or 1)
    if expected_revision is not None and int(expected_revision) != current:
        raise RevisionConflict(current)
    _conditional_update(db, int(row.id), current, {"deleted_at": utcnow()})
    db.commit()


@_atomic
def reorder_entries(
    db: Session,
    section_key: str,
    entry_ids: list[str],
    *,
    expected_revision: int | None = None,
) -> list[ProfileEntry]:
    """分区内重排；expected_revision 语义 = workspace state.revision（§4）。"""
    section = _require_active_section(db, section_key)
    state = workspace_bootstrap.ensure_workspace(db)
    if expected_revision is not None and int(expected_revision) != int(state.revision or 1):
        raise RevisionConflict(int(state.revision or 1))
    rows = (
        db.query(ProfileEntry)
        .filter(
            ProfileEntry.section_key == section,
            ProfileEntry.deleted_at.is_(None),
        )
        .order_by(ProfileEntry.sort_order.asc(), ProfileEntry.id.asc())
        .all()
    )
    requested = [str(item or "").strip() for item in (entry_ids or [])]
    if len(requested) != len(set(requested)) or set(requested) != {row.entry_id for row in rows}:
        raise ValidationError(
            "排序清单必须恰好包含该大字段下全部记录（不能缺少、多出或重复）：请刷新页面后重试",
            code="invalid_reorder",
        )
    by_id = {row.entry_id: row for row in rows}
    offset = max((int(row.sort_order or 0) for row in rows), default=0) + 1000
    for position, entry_id in enumerate(requested):
        row = by_id[entry_id]
        db.execute(
            update(ProfileEntry)
            .where(ProfileEntry.id == row.id)
            .values(sort_order=offset + position + 1)
            .execution_options(synchronize_session=False)
        )
    for position, entry_id in enumerate(requested):
        row = by_id[entry_id]
        current = int(row.revision or 1)
        result = cast(
            "CursorResult[Any]",
            db.execute(
                update(ProfileEntry)
                .where(
                    ProfileEntry.id == row.id,
                    ProfileEntry.revision == current,
                    ProfileEntry.deleted_at.is_(None),
                )
                .values(sort_order=position, revision=current + 1, updated_at=utcnow())
                .execution_options(synchronize_session=False)
            ),
        )
        if result.rowcount != 1:
            db.rollback()
            raise RevisionConflict(_row_revision(db, int(row.id)))
    db.commit()
    for row in rows:
        db.refresh(row)
    return [by_id[entry_id] for entry_id in requested]


__all__ = [
    "bulk_save_entries",
    "delete_entry",
    "get_entry",
    "list_entries",
    "reorder_entries",
    "upsert_entry",
]
