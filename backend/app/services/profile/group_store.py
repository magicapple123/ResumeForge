# SPDX-License-Identifier: Apache-2.0
"""资料组、参与清单与当前组状态（契约 §4 group_store）。

**组不拥有数据**（R-17）：组只是"名称 + 参与清单"，参与关系落在 profile_group_member，
任何组操作都不写资料条目。当前组是数据集级单行状态（R-24）：切换/删除当前组都在 state
上做条件写；删当前组时同事务切回默认组并写 pending_notice（R-25），不存在"无当前组"。

**默认组恒存在、不可删**（R-20）：服务层先拒（ValidationError default_group_protected），
数据库层还有 CHECK 兜底。参与清单只有"在/不在"（R-22），展示顺序永远取全局
section_order；basic_info 恒参与且首位（R-21），落库时补、读取时补。
"""

from __future__ import annotations

import uuid
from functools import wraps
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_group import ProfileGroup, ProfileGroupMember, ProfileWorkspaceState
from . import value_validation, workspace_bootstrap
from .definition_catalog import SECTION_BY_KEY
from .errors import Conflict, LimitReached, NotFound, RevisionConflict, ValidationError

_MAX_GROUPS = value_validation.MAX_GROUPS
_GROUP_MISSING = "组不存在或已删除：请刷新页面后重试"
_DEFAULT_PROTECTED = "默认组不能删除：它是当前组被删时唯一的降级落点，只能改名"
_ATOMIC_FAILED = "保存失败：内容可能刚被其他窗口修改或名称已被占用，请刷新页面后重试"


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


def _validate_group_name(raw: str) -> tuple[str, str]:
    name = str(raw or "").strip()
    limit = value_validation.MAX_SECTION_NAME_CHARS
    if not name:
        raise ValidationError(
            "组名称不能为空：请填写 1–40 个字符的名称后重试", code="group_name_empty"
        )
    if len(name) > limit:
        raise ValidationError(
            f"组名称不能超过 {limit} 个字符（当前 {len(name)}）：请缩短后重试",
            code="group_name_too_long",
        )
    return name, value_validation.normalize_name_key(name)


def _active_group_row(db: Session, group_id: str) -> ProfileGroup | None:
    return (
        db.query(ProfileGroup)
        .filter(
            ProfileGroup.group_id == str(group_id or "").strip(),
            ProfileGroup.deleted_at.is_(None),
        )
        .first()
    )


def _require_active_group(db: Session, group_id: str) -> ProfileGroup:
    row = _active_group_row(db, group_id)
    if row is None:
        raise NotFound(_GROUP_MISSING)
    return row


def _row_revision(db: Session, pk: int) -> int:
    value = db.query(ProfileGroup.revision).filter(ProfileGroup.id == pk).scalar()
    return int(value or 0)


def _conditional_update(db: Session, pk: int, current: int, values: dict[str, Any]) -> None:
    # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(ProfileGroup)
            .where(
                ProfileGroup.id == pk,
                ProfileGroup.revision == current,
                ProfileGroup.deleted_at.is_(None),
            )
            .values(**values, revision=current + 1, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        ),
    )
    if result.rowcount != 1:
        db.rollback()
        raise RevisionConflict(_row_revision(db, pk))


def _require_revision(row: ProfileGroup, expected_revision: int) -> int:
    current = int(row.revision or 1)
    if int(expected_revision) != current:
        raise RevisionConflict(current)
    return current


def _ensure_name_free(db: Session, name_key: str, *, exclude_pk: int | None = None) -> None:
    query = db.query(ProfileGroup).filter(
        ProfileGroup.deleted_at.is_(None), ProfileGroup.name_key == name_key
    )
    if exclude_pk is not None:
        query = query.filter(ProfileGroup.id != exclude_pk)
    duplicate = query.first()
    if duplicate is not None:
        raise ValidationError(
            f"已有同名组「{duplicate.name}」：请换一个名称后重试",
            code="group_name_duplicate",
        )


def list_groups(db: Session) -> list[ProfileGroup]:
    """活动组列表：默认组在前，其余按创建时间升序（R-18/R-20）。"""
    workspace_bootstrap.ensure_workspace(db)
    return (
        db.query(ProfileGroup)
        .filter(ProfileGroup.deleted_at.is_(None))
        .order_by(
            ProfileGroup.is_default.desc(),
            ProfileGroup.created_at.asc(),
            ProfileGroup.id.asc(),
        )
        .all()
    )


def get_group(db: Session, group_id: str, *, include_deleted: bool = False) -> ProfileGroup | None:
    """按外部 id 取组；默认把回收站里的当作不存在。"""
    query = db.query(ProfileGroup).filter(ProfileGroup.group_id == str(group_id or "").strip())
    if not include_deleted:
        query = query.filter(ProfileGroup.deleted_at.is_(None))
    return query.first()


def group_participating_keys(db: Session, group: ProfileGroup) -> list[str]:
    """参与清单：按全局 section_order 排序，basic_info 恒在首位（R-21/R-22）。"""
    workspace_bootstrap.ensure_workspace(db)
    return workspace_bootstrap.repair_group_members(db, group)


@_atomic
def create_group(db: Session, name: str) -> ProfileGroup:
    """新建组：名称唯一、活动组 ≤20；参与清单可为空（落库时补 basic_info）。"""
    workspace_bootstrap.ensure_workspace(db)
    clean_name, name_key = _validate_group_name(name)
    _ensure_name_free(db, name_key)
    count = db.query(ProfileGroup).filter(ProfileGroup.deleted_at.is_(None)).count()
    if count >= _MAX_GROUPS:
        raise LimitReached(
            f"组数量最多 {_MAX_GROUPS} 个（当前已有 {count} 个）：请先删除不用的组后再新建",
            code="limit_reached",
        )
    row = ProfileGroup(
        group_id=workspace_bootstrap.generate_external_id(db, ProfileGroup, "group_id"),
        name=clean_name,
        name_key=name_key,
        is_default=False,
        revision=1,
    )
    db.add(row)
    db.flush()
    db.add(ProfileGroupMember(group_id=row.group_id, section_key="basic_info"))
    db.commit()
    db.refresh(row)
    return row


@_atomic
def rename_group(db: Session, group_id: str, name: str, *, expected_revision: int) -> ProfileGroup:
    """改名（默认组也可改名，R-20）；条件写失败 → 409 带当前 revision。"""
    row = _require_active_group(db, group_id)
    current = _require_revision(row, expected_revision)
    clean_name, name_key = _validate_group_name(name)
    _ensure_name_free(db, name_key, exclude_pk=int(row.id))
    _conditional_update(db, int(row.id), current, {"name": clean_name, "name_key": name_key})
    db.commit()
    db.refresh(row)
    return row


@_atomic
def delete_group(db: Session, group_id: str, *, expected_revision: int) -> dict[str, Any]:
    """软删组：只删清单不动资料；删的是当前组时同事务切回默认组并留下降级告知。"""
    state = workspace_bootstrap.ensure_workspace(db)
    row = _require_active_group(db, group_id)
    if row.is_default:
        raise ValidationError(_DEFAULT_PROTECTED, code="default_group_protected")
    current = _require_revision(row, expected_revision)
    switched_to: str | None = None
    notice_id: str | None = None
    if state.current_group_id == row.group_id:
        default = workspace_bootstrap.active_group(db, state.default_group_id)
        if default is None:  # ensure_workspace 已保证默认组存在，这里只是防御
            raise NotFound(_DEFAULT_PROTECTED)
        switched_to = default.group_id
        notice_id = uuid.uuid4().hex[:24]
        state.current_group_id = default.group_id
        state.pending_notice = {
            "kind": "current_group_deleted",
            "group_id": row.group_id,
            "group_name": row.name,
            "message": "当前组已删除，已切换到默认组",
        }
        state.notice_id = notice_id
        state.revision = int(state.revision or 1) + 1
        state.updated_at = utcnow()
    _conditional_update(db, int(row.id), current, {"deleted_at": utcnow()})
    db.commit()
    return {
        "deleted_group_id": row.group_id,
        "switched_to": switched_to,
        "notice_id": notice_id,
    }


@_atomic
def set_group_members(
    db: Session, group_id: str, section_keys: list[str], *, expected_revision: int
) -> list[str]:
    """整份替换参与清单：只增删关系行，不动任何资料；basic_info 强制加入（R-21）。"""
    workspace_bootstrap.ensure_workspace(db)
    row = _require_active_group(db, group_id)
    current = _require_revision(row, expected_revision)
    known = set(workspace_bootstrap.active_section_keys(db))
    requested: list[str] = []
    for raw in section_keys or []:
        key = str(raw or "").strip()
        if not key:
            continue
        if key not in known:
            raise ValidationError(
                f"大字段「{key}」不存在或已删除：请刷新页面后重新选择",
                code="section_not_found",
            )
        if key not in requested:
            requested.append(key)
    if "basic_info" not in requested:
        requested.insert(0, "basic_info")
    existing = {
        member.section_key: member
        for member in db.query(ProfileGroupMember)
        .filter(ProfileGroupMember.group_id == row.group_id)
        .all()
    }
    for key, member in existing.items():
        if key not in requested:
            db.delete(member)
    for key in requested:
        if key not in existing:
            db.add(ProfileGroupMember(group_id=row.group_id, section_key=key))
    _conditional_update(db, int(row.id), current, {})
    db.commit()
    db.refresh(row)
    return workspace_bootstrap.repair_group_members(db, row)


@_atomic
def switch_current_group(
    db: Session, group_id: str, *, expected_revision: int
) -> ProfileWorkspaceState:
    """唯一切换入口（R-24）：目标必须是活动组；只改 state.current_group_id。"""
    state = workspace_bootstrap.ensure_workspace(db)
    row = _require_active_group(db, group_id)
    current = int(state.revision or 1)
    if int(expected_revision) != current:
        raise RevisionConflict(current)
    if state.current_group_id != row.group_id:
        state.current_group_id = row.group_id
        state.revision = current + 1
        state.updated_at = utcnow()
        db.commit()
        db.refresh(state)
    return state


def read_state(db: Session) -> ProfileWorkspaceState:
    """当前工作区状态（先 ensure_workspace）。"""
    return workspace_bootstrap.ensure_workspace(db)


@_atomic
def set_section_order(
    db: Session, order: list[str], *, expected_revision: int
) -> ProfileWorkspaceState:
    """写全局唯一顺序：恰含全部活动分区，basic_info 首位，自建按创建序号固定在 13 内置之后。"""
    state = workspace_bootstrap.ensure_workspace(db)
    current = int(state.revision or 1)
    if int(expected_revision) != current:
        raise RevisionConflict(current)
    cleaned = [str(key or "").strip() for key in (order or [])]
    active = workspace_bootstrap.active_section_keys(db)
    if len(cleaned) != len(set(cleaned)) or set(cleaned) != set(active):
        raise ValidationError(
            "全局顺序必须恰好包含全部大字段（不能缺少、多出或重复）：请刷新页面后重试",
            code="invalid_section_order",
        )
    if cleaned[0] != "basic_info":
        raise ValidationError(
            "基本信息必须排在第一位，不能移动：请把它放回第一位后重试",
            code="basic_info_first",
        )
    custom_tail = [key for key in active if key not in SECTION_BY_KEY]
    if cleaned[len(active) - len(custom_tail) :] != custom_tail:
        raise ValidationError(
            "自建大字段固定排在 13 个系统大字段之后、彼此按创建顺序：请刷新页面后重新排序",
            code="custom_section_tail",
        )
    state.section_order = cleaned
    state.revision = current + 1
    state.updated_at = utcnow()
    db.commit()
    db.refresh(state)
    return state


def ack_notice(db: Session, notice_id: str) -> bool:
    """确认当前组降级告知：只清匹配的 notice_id，不匹配返回 False（R-25）。"""
    text = str(notice_id or "").strip()
    if not text:
        return False
    try:
        state = workspace_bootstrap.ensure_workspace(db)
        if not state.notice_id or state.notice_id != text:
            return False
        state.pending_notice = None
        state.notice_id = None
        state.revision = int(state.revision or 1) + 1
        state.updated_at = utcnow()
        db.commit()
        db.refresh(state)
        return True
    except Exception:
        db.rollback()
        raise


__all__ = [
    "ack_notice",
    "create_group",
    "delete_group",
    "get_group",
    "group_participating_keys",
    "list_groups",
    "read_state",
    "rename_group",
    "set_group_members",
    "set_section_order",
    "switch_current_group",
]
