# SPDX-License-Identifier: Apache-2.0
"""定义合并视图（默认定义 + 自建定义 + 用户偏好）与字段偏好的读写。

**为什么合并视图在这一层**（契约 §4 的 MergedSection/MergedField）：编辑视图要把三类来源
拼成一份有序清单——13 个内置大字段与 106 个默认小字段（definition_catalog，只读）、
用户自建的大字段/小字段（profile_custom_*），以及每个字段的 hidden/collapsed_override
偏好（profile_field_preference）。拆分与拼接逻辑只写一次，definition_store 的读接口与
API 的 field_out/section_out 都从这里取，避免"一个入口有 collapsed_override、另一个没有"
的漂移；字段顺序固定为默认字段在前、自建字段在后（R-16）。

**两个偏好状态必须独立**（R-66/R-67）：hidden 是参与性排除；collapsed_override 是
"用户手动展开/收起过"的展示记忆，NULL = 跟随代码默认。任何把两者合并的实现都会让隐藏
恢复后丢失展开记忆。三态更新用模块级哨兵区分"没传"（保持）与"传 None"（恢复默认）。

**偏好行缺失 = 全默认**：不为 13×106 个字段预建行；第一次改哪个字段才建哪一行。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_definition import (
    ProfileCustomField,
    ProfileCustomSection,
    ProfileFieldPreference,
)
from . import field_placement, workspace_bootstrap
from .definition_catalog import (
    BUILTIN_SECTION_KEYS,
    BUILTIN_SECTIONS,
    FIELD_BY_ID,
    SECTION_BY_KEY,
)
from .errors import RevisionConflict, ValidationError

_UNSET: Any = object()


@dataclass(frozen=True)
class MergedField:
    """编辑 DTO 用的合并字段：定义 + 用户偏好（hidden/collapsed_override）。"""

    field_id: str
    key: str
    label: str
    field_type: str
    order: int
    default_collapsed: bool
    enum_suggestions: tuple[str, ...]
    is_builtin: bool
    private: bool
    # 纸面默认位置与仅素材（0069，v2 文档模型 D6）：只对自建字段可写；
    # 内置字段的默认位置由文档字段目录（document_catalog）决定，这里保持 None/False。
    default_placement: str | None
    material_only: bool
    llm_allowed: bool
    webform_allowed: bool
    section_key: str
    hidden: bool
    collapsed_override: bool | None
    preference_revision: int
    revision: int

    @property
    def effective_placement(self) -> str | None:
        """自建字段真正落到的纸面位置；内置字段由文档字段目录决定（这里给 None）。"""
        if self.is_builtin:
            return None
        return field_placement.effective_placement(
            self.field_type, self.default_placement, self.material_only
        )


@dataclass(frozen=True)
class MergedSection:
    """编辑 DTO 用的合并大字段；revision：自建=定义 revision，内置=0。"""

    key: str
    name: str
    form: str
    is_builtin: bool
    carrier_field_id: str | None
    material_only: bool
    provenance: tuple[str, ...]
    fields: tuple[MergedField, ...]
    revision: int


def _pref_parts(pref: Any) -> tuple[bool, bool | None, int]:
    if pref is None:
        return False, None, 0
    return bool(pref.hidden), pref.collapsed_override, int(pref.revision or 1)


def _builtin_field(spec: Any, pref: Any) -> MergedField:
    hidden, collapsed, pref_revision = _pref_parts(pref)
    return MergedField(
        spec.field_id,
        spec.key,
        spec.label,
        spec.field_type,
        spec.order,
        spec.default_collapsed,
        spec.enum_suggestions,
        True,
        spec.private,
        None,
        False,
        spec.llm_allowed,
        spec.webform_allowed,
        spec.section_key,
        hidden,
        collapsed,
        pref_revision,
        0,
    )


def _custom_field(row: ProfileCustomField, pref: Any, *, order: int) -> MergedField:
    hidden, collapsed, pref_revision = _pref_parts(pref)
    return MergedField(
        row.field_id,
        row.field_id,
        row.label,
        row.field_type,
        order,
        False,
        (),
        False,
        False,
        row.default_placement,
        bool(row.material_only),
        True,
        True,
        row.section_key,
        hidden,
        collapsed,
        pref_revision,
        int(row.revision or 1),
    )


def _merge_builtin_section(
    spec: Any, prefs: dict[str, Any], custom_rows: list[ProfileCustomField]
) -> MergedSection:
    fields = [_builtin_field(field, prefs.get(field.field_id)) for field in spec.fields]
    base = len(fields)
    fields += [
        _custom_field(row, prefs.get(row.field_id), order=base + index)
        for index, row in enumerate(custom_rows, start=1)
    ]
    return MergedSection(
        spec.key,
        spec.name,
        spec.form,
        True,
        spec.carrier_field_id,
        spec.material_only,
        spec.provenance,
        tuple(fields),
        0,
    )


def _merge_custom_section(
    row: ProfileCustomSection, prefs: dict[str, Any], custom_rows: list[ProfileCustomField]
) -> MergedSection:
    fields = tuple(
        _custom_field(field_row, prefs.get(field_row.field_id), order=index)
        for index, field_row in enumerate(custom_rows, start=1)
    )
    return MergedSection(
        row.key,
        row.name,
        "multi",
        False,
        row.primary_field_id,
        False,
        (),
        fields,
        int(row.revision or 1),
    )


def custom_field_rows(
    db: Session, *, section_key: str | None = None, include_deleted: bool = False
) -> list[ProfileCustomField]:
    query = db.query(ProfileCustomField)
    if section_key is not None:
        query = query.filter(ProfileCustomField.section_key == section_key)
    if not include_deleted:
        query = query.filter(ProfileCustomField.deleted_at.is_(None))
    return query.order_by(ProfileCustomField.sort_order.asc(), ProfileCustomField.id.asc()).all()


def active_custom_section(
    db: Session, key: str, *, include_deleted: bool = False
) -> ProfileCustomSection | None:
    query = db.query(ProfileCustomSection).filter(
        ProfileCustomSection.key == str(key or "").strip()
    )
    if not include_deleted:
        query = query.filter(ProfileCustomSection.deleted_at.is_(None))
    return query.first()


def active_custom_field(db: Session, section_key: str, field_id: str) -> ProfileCustomField | None:
    return (
        db.query(ProfileCustomField)
        .filter(
            ProfileCustomField.field_id == field_id,
            ProfileCustomField.section_key == section_key,
            ProfileCustomField.deleted_at.is_(None),
        )
        .first()
    )


def merged_custom_section(db: Session, row: ProfileCustomSection) -> MergedSection:
    """单个自建分区的编辑 DTO（字段=该分区活动自定义字段）。"""
    return _merge_custom_section(
        row, load_preferences(db), custom_field_rows(db, section_key=row.key)
    )


def merged_custom_field(db: Session, row: ProfileCustomField) -> MergedField:
    """单个自定义字段的编辑 DTO（order 按"默认字段在前、自建在后"计算）。"""
    rows = custom_field_rows(db, section_key=row.section_key)
    base = len(SECTION_BY_KEY[row.section_key].fields) if row.section_key in SECTION_BY_KEY else 0
    index = next((position for position, item in enumerate(rows, start=1) if item.id == row.id), 1)
    return _custom_field(row, load_preferences(db).get(row.field_id), order=base + index)


def build_sections(db: Session, *, include_deleted_fields: bool = False) -> list[MergedSection]:
    """编辑视图里的全部活动分区：内置 13 按 state.section_order，自建按创建序号在尾部。"""
    state = workspace_bootstrap.ensure_workspace(db)
    prefs = load_preferences(db)
    rows_by_section: dict[str, list[ProfileCustomField]] = {}
    for row in custom_field_rows(db, include_deleted=include_deleted_fields):
        rows_by_section.setdefault(row.section_key, []).append(row)
    sections = {
        spec.key: _merge_builtin_section(spec, prefs, rows_by_section.get(spec.key, []))
        for spec in BUILTIN_SECTIONS
    }
    custom_sections = workspace_bootstrap.active_custom_sections(db)
    for row in custom_sections:
        sections[row.key] = _merge_custom_section(row, prefs, rows_by_section.get(row.key, []))
    order = [str(key) for key in (state.section_order or [])]
    result = [sections[key] for key in order if key in sections]
    seen = {section.key for section in result}
    for key in [*BUILTIN_SECTION_KEYS, *(row.key for row in custom_sections)]:
        if key not in seen:
            result.append(sections[key])
            seen.add(key)
    return result


def build_section(db: Session, key: str, *, include_deleted: bool = False) -> MergedSection | None:
    """按 key 取一个分区的编辑 DTO；不存在返回 None。"""
    section_key = str(key or "").strip()
    if not section_key:
        return None
    workspace_bootstrap.ensure_workspace(db)
    prefs = load_preferences(db)
    spec = SECTION_BY_KEY.get(section_key)
    if spec is not None:
        return _merge_builtin_section(spec, prefs, custom_field_rows(db, section_key=section_key))
    row = active_custom_section(db, section_key, include_deleted=include_deleted)
    if row is None:
        return None
    return _merge_custom_section(row, prefs, custom_field_rows(db, section_key=section_key))


def load_preferences(db: Session) -> dict[str, ProfileFieldPreference]:
    """field_id → 偏好行（只含用户实际设置过的字段）。"""
    rows = db.query(ProfileFieldPreference).all()
    return {row.field_id: row for row in rows}


def preference_map(db: Session) -> dict[str, dict[str, Any]]:
    """编辑 DTO 合并用的轻量形状：hidden / collapsed_override / revision。"""
    return {
        field_id: {
            "hidden": bool(row.hidden),
            "collapsed_override": row.collapsed_override,
            "revision": int(row.revision or 1),
        }
        for field_id, row in load_preferences(db).items()
    }


def _field_in_section(db: Session, field_id: str, section_key: str) -> bool:
    """字段必须属于声明的大字段：内置字段查目录，自定义字段查活动定义（R-67）。"""
    builtin = FIELD_BY_ID.get(field_id)
    if builtin is not None:
        return builtin.section_key == section_key
    return active_custom_field(db, section_key, field_id) is not None


def _current_revision(db: Session, pk: int) -> int:
    value = (
        db.query(ProfileFieldPreference.revision).filter(ProfileFieldPreference.id == pk).scalar()
    )
    return int(value or 0)


def patch_preference(
    db: Session,
    field_id: str,
    *,
    section_key: str,
    hidden: bool | None = None,
    collapsed_override: Any = _UNSET,
    expected_revision: int | None = None,
) -> ProfileFieldPreference:
    """局部更新一个字段的偏好；未涉及的另一个状态保持原值。

    - 行不存在时创建（revision=1），响应里的 preference_revision=1 供下一次条件写使用；
    - expected_revision 与库里当前值不符 → RevisionConflict（409 带 revision）；
    - 未知字段 / 跨分区字段 → ValidationError(code="unknown_field")。
    """
    field_key = str(field_id or "").strip()
    section = str(section_key or "").strip()
    if not field_key or not _field_in_section(db, field_key, section):
        raise ValidationError(
            f"字段「{field_key or '空'}」不属于大字段「{section or '空'}」（可能已被删除）："
            "请刷新页面后重新设置",
            code="unknown_field",
        )
    try:
        row = (
            db.query(ProfileFieldPreference)
            .filter(ProfileFieldPreference.field_id == field_key)
            .first()
        )
        current = int(row.revision or 1) if row is not None else 0
        if expected_revision is not None and int(expected_revision) != current:
            raise RevisionConflict(current)
        updates: dict[str, Any] = {}
        if hidden is not None:
            updates["hidden"] = bool(hidden)
        if collapsed_override is not _UNSET:
            updates["collapsed_override"] = (
                None if collapsed_override is None else bool(collapsed_override)
            )
        if row is None:
            row = ProfileFieldPreference(
                section_key=section,
                field_id=field_key,
                hidden=bool(updates.get("hidden", False)),
                collapsed_override=updates.get("collapsed_override"),
                revision=1,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row
        if not any(getattr(row, name) != value for name, value in updates.items()):
            return row
        pk = int(row.id)
        # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
        result = cast(
            "CursorResult[Any]",
            db.execute(
                update(ProfileFieldPreference)
                .where(
                    ProfileFieldPreference.id == pk,
                    ProfileFieldPreference.revision == current,
                )
                .values(**updates, revision=current + 1, updated_at=utcnow())
                .execution_options(synchronize_session=False)
            ),
        )
        if result.rowcount != 1:
            db.rollback()
            raise RevisionConflict(_current_revision(db, pk))
        db.commit()
        db.refresh(row)
        return row
    except (ValidationError, RevisionConflict):
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


__all__ = [
    "MergedField",
    "MergedSection",
    "active_custom_field",
    "active_custom_section",
    "build_section",
    "build_sections",
    "custom_field_rows",
    "load_preferences",
    "merged_custom_field",
    "merged_custom_section",
    "patch_preference",
    "preference_map",
]
