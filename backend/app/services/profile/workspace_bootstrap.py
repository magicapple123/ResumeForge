# SPDX-License-Identifier: Apache-2.0
"""资料工作区的幂等初始化与修复：默认组、当前组、全局顺序（契约 §4 bootstrap）。

**为什么读路径也要（有条件地）写库**：新模型在旧库上升级后没有组、没有 state、也没有
条目。读取不 bootstrap，资料页第一次打开就是"无当前组"的非法中间态；而损坏数据
（默认组被外部删掉、全局顺序缺项、组里挂着已删除分区）不在读路径修复，界面就会拿到
残缺清单。所以 `ensure_workspace` 是"幂等初始化 + 修复"，但**只在确有变化时提交**：
连续两次 GET 必须返回同一个 workspace_revision，否则每个窗口手里的版本号都会无意义地
过期（契约 §4 bootstrap 4 / 验收 A 的幂等要求）。

**当前组永远有值**（R-24/R-25）：state.current_group_id 指向不存在/已软删的组时，同一
事务内切回默认组并写入 pending_notice（`current_group_missing`），由前端展示后经
notice_id 确认；不存在"无当前组"的中间态。默认组缺失属于异常数据：重建默认组并把它缺的
13 项参与关系补回，同为单事务。

**不做的事**（契约 §4 bootstrap 5）：不伪造已填写条目、不创建 user_profile 记录、不读任何
旧资料表——"升级后新界面读不到旧数据"是产品决定（R-46），bootstrap 不能偷偷搬运。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_definition import ProfileCustomSection
from ...models.profile_group import ProfileGroup, ProfileGroupMember, ProfileWorkspaceState
from .definition_catalog import BUILTIN_SECTION_KEYS, SECTION_BY_KEY, built_in_seed_section_keys
from .errors import Conflict
from .value_validation import normalize_name_key

DEFAULT_GROUP_NAME = "默认组"
_ID_ATTEMPTS = 8


def _live(model: Any) -> Any:
    """活动行条件；与 trash.live_only 同语义，但本模块不依赖回收站。"""
    return model.deleted_at.is_(None)


def generate_external_id(db: Session, model: Any, column_name: str) -> str:
    """生成库内唯一的外部稳定 id（uuid4().hex[:24]，与 ProfileFact.fact_id 同规则）。

    契约 §1.3 要求"生成函数带重试"：碰撞概率极低，但唯一约束一旦被撞就是 500，
    所以先查再返回，仍冲突由调用方的 IntegrityError 兜底。
    """
    column = getattr(model, column_name)
    for _ in range(_ID_ATTEMPTS):
        candidate = uuid.uuid4().hex[:24]
        if db.query(model).filter(column == candidate).first() is None:
            return candidate
    raise Conflict("无法生成唯一编号：请重试一次；若仍失败，请重启应用后再试")


def _get_state(db: Session) -> ProfileWorkspaceState | None:
    return db.query(ProfileWorkspaceState).filter(ProfileWorkspaceState.id == 1).first()


def active_group(db: Session, group_id: str | None) -> ProfileGroup | None:
    """按外部 id 取活动组（已软删的当作不存在）。"""
    text = str(group_id or "").strip()
    if not text:
        return None
    return db.query(ProfileGroup).filter(ProfileGroup.group_id == text, _live(ProfileGroup)).first()


def current_group(db: Session, state: ProfileWorkspaceState | None = None) -> ProfileGroup | None:
    """当前组（先 ensure）；正常数据里恒非 None，异常时由 repair 切回默认组。"""
    if state is None:
        state = ensure_workspace(db)
    return active_group(db, state.current_group_id)


def active_custom_sections(db: Session) -> list[ProfileCustomSection]:
    """活动自建大字段，按创建序号升序（自建分区之间只有这一个顺序，R-08）。"""
    return (
        db.query(ProfileCustomSection)
        .filter(_live(ProfileCustomSection))
        .order_by(ProfileCustomSection.sort_order.asc(), ProfileCustomSection.id.asc())
        .all()
    )


def active_custom_section_keys(db: Session) -> list[str]:
    return [row.key for row in active_custom_sections(db)]


def active_section_keys(db: Session) -> list[str]:
    """全部活动分区 key：13 个内置（固定顺序）+ 活动自建（创建顺序）。"""
    return [*BUILTIN_SECTION_KEYS, *active_custom_section_keys(db)]


def is_active_section_key(db: Session, key: str) -> bool:
    text = str(key or "").strip()
    return text in SECTION_BY_KEY or text in set(active_custom_section_keys(db))


def _bootstrap(db: Session) -> ProfileWorkspaceState:
    """无 state 行：同一事务建默认组（参与 13 内置）+ 单行 state；唯一冲突重试一次。"""
    last_error: Exception | None = None
    for _ in range(2):
        try:
            default = ProfileGroup(
                group_id=generate_external_id(db, ProfileGroup, "group_id"),
                name=DEFAULT_GROUP_NAME,
                name_key=normalize_name_key(DEFAULT_GROUP_NAME),
                is_default=True,
                revision=1,
            )
            db.add(default)
            db.flush()
            for section_key in built_in_seed_section_keys():
                db.add(ProfileGroupMember(group_id=default.group_id, section_key=section_key))
            state = ProfileWorkspaceState(
                id=1,
                current_group_id=default.group_id,
                default_group_id=default.group_id,
                section_order=built_in_seed_section_keys(),
                revision=1,
            )
            db.add(state)
            db.commit()
            db.refresh(state)
            return state
        except IntegrityError as exc:  # 并发 bootstrap：另一事务已经建好，直接修复重读
            last_error = exc
            db.rollback()
            existing = _get_state(db)
            if existing is not None:
                return _repair(db, existing)
    raise Conflict("初始化资料工作区失败：请重试一次；若仍失败，请重启应用后再试") from last_error


def _ensure_default_group(db: Session, state: ProfileWorkspaceState) -> tuple[ProfileGroup, bool]:
    """默认组缺失时重建/提升，并补齐 13 项内置参与关系。返回 (默认组, 是否有改动)。"""
    default = (
        db.query(ProfileGroup)
        .filter(ProfileGroup.is_default.is_(True), _live(ProfileGroup))
        .first()
    )
    if default is not None:
        return default, False
    candidate = active_group(db, state.default_group_id)
    if candidate is None:
        candidate = (
            db.query(ProfileGroup)
            .filter(
                _live(ProfileGroup),
                ProfileGroup.name_key == normalize_name_key(DEFAULT_GROUP_NAME),
            )
            .first()
        )
    if candidate is None:
        candidate = ProfileGroup(
            group_id=generate_external_id(db, ProfileGroup, "group_id"),
            name=DEFAULT_GROUP_NAME,
            name_key=normalize_name_key(DEFAULT_GROUP_NAME),
            is_default=True,
            revision=1,
        )
        db.add(candidate)
        db.flush()
    else:
        candidate.is_default = True
    existing = {
        row.section_key
        for row in db.query(ProfileGroupMember)
        .filter(ProfileGroupMember.group_id == candidate.group_id)
        .all()
    }
    for section_key in built_in_seed_section_keys():
        if section_key not in existing:
            db.add(ProfileGroupMember(group_id=candidate.group_id, section_key=section_key))
    candidate.revision = int(candidate.revision or 1) + 1
    candidate.updated_at = utcnow()
    db.flush()
    return candidate, True


def _compute_section_order(db: Session, current: Any) -> tuple[list[str], bool]:
    """规范顺序：13 内置齐全且 basic_info 首位（可拖动其余）+ 活动自建按创建序号在尾部。"""
    custom_keys = active_custom_section_keys(db)
    known = set(BUILTIN_SECTION_KEYS) | set(custom_keys)
    seen: set[str] = set()
    builtin_part: list[str] = []
    for raw in current or []:
        key = str(raw)
        if key in known and key not in seen:
            seen.add(key)
            builtin_part.append(key)
    builtin_part = [key for key in builtin_part if key in SECTION_BY_KEY]
    for key in BUILTIN_SECTION_KEYS:
        if key not in seen:
            builtin_part.append(key)
            seen.add(key)
    if builtin_part and builtin_part[0] != "basic_info":
        builtin_part = ["basic_info", *[key for key in builtin_part if key != "basic_info"]]
    desired = [*builtin_part, *custom_keys]
    raw_current = [str(key) for key in (current or [])]
    return desired, desired != raw_current


def _repair(db: Session, state: ProfileWorkspaceState) -> ProfileWorkspaceState:
    """在既有 state 上做全部修复；只有确有变化时才提交并推进 state.revision。"""
    changed = False
    default, rebuilt = _ensure_default_group(db, state)
    changed = changed or rebuilt
    if state.default_group_id != default.group_id:
        state.default_group_id = default.group_id
        changed = True
    current = active_group(db, state.current_group_id)
    if current is None:
        missing_id = str(state.current_group_id or "")
        missing = db.query(ProfileGroup).filter(ProfileGroup.group_id == missing_id).first()
        state.current_group_id = default.group_id
        state.pending_notice = {
            "kind": "current_group_missing",
            "group_id": missing_id,
            "group_name": missing.name if missing is not None else "",
            "message": "当前组已不可用，已切换到默认组",
        }
        state.notice_id = uuid.uuid4().hex[:24]
        changed = True
    desired, order_changed = _compute_section_order(db, state.section_order)
    if order_changed:
        state.section_order = desired
        changed = True
    if changed:
        state.revision = int(state.revision or 1) + 1
        state.updated_at = utcnow()
        db.commit()
        db.refresh(state)
    return state


def ensure_workspace(db: Session) -> ProfileWorkspaceState:
    """幂等 bootstrap + 修复，必要时提交（契约 §4）。"""
    try:
        state = _get_state(db)
        if state is None:
            return _bootstrap(db)
        return _repair(db, state)
    except Exception:
        db.rollback()
        raise


def repair_section_order(db: Session, state: ProfileWorkspaceState | None = None) -> list[str]:
    """把 state.section_order 修成规范顺序并落库；返回修复后的顺序。"""
    if state is None:
        state = ensure_workspace(db)
    desired, changed = _compute_section_order(db, state.section_order)
    if changed:
        state.section_order = desired
        state.revision = int(state.revision or 1) + 1
        state.updated_at = utcnow()
        try:
            db.commit()
            db.refresh(state)
        except Exception:
            db.rollback()
            raise
    return desired


def repair_group_members(db: Session, group: ProfileGroup) -> list[str]:
    """修复一个组的参与关系并返回"活动且有效"的参与 key（按全局顺序、basic_info 首位）。

    "无效 key"只指**任何定义里都不存在**的 key：已软删的自建分区关系行必须保留，
    否则从回收站恢复分区后就丢了参与清单（契约 §2.5/§4 组关系保留供撤销）。软删分区的
    关系不参与展示，但也不删除。
    """
    group_key = str(getattr(group, "group_id", "") or "")
    if not group_key:
        return []
    all_custom = {row[0] for row in db.query(ProfileCustomSection.key).all()}
    known = set(BUILTIN_SECTION_KEYS) | {str(key) for key in all_custom}
    rows = db.query(ProfileGroupMember).filter(ProfileGroupMember.group_id == group_key).all()
    member_keys = {row.section_key for row in rows}
    changed = False
    for row in rows:
        if row.section_key not in known:
            db.delete(row)
            changed = True
    if "basic_info" not in member_keys:
        db.add(ProfileGroupMember(group_id=group_key, section_key="basic_info"))
        changed = True
    if changed:
        group.revision = int(group.revision or 1) + 1
        group.updated_at = utcnow()
        try:
            db.commit()
            db.refresh(group)
        except Exception:
            db.rollback()
            raise
    active = set(BUILTIN_SECTION_KEYS) | set(active_custom_section_keys(db))
    participants = {
        row[0]
        for row in db.query(ProfileGroupMember.section_key)
        .filter(ProfileGroupMember.group_id == group_key)
        .all()
    } & active
    state = _get_state(db)
    order = (
        [str(key) for key in (state.section_order or [])]
        if state is not None
        else built_in_seed_section_keys()
    )
    result = [key for key in order if key in participants]
    result.extend(sorted(participants - set(result)))
    if "basic_info" in participants and (not result or result[0] != "basic_info"):
        result = ["basic_info", *[key for key in result if key != "basic_info"]]
    return result


def section_order(db: Session) -> list[str]:
    """当前全局顺序（先 ensure_workspace）。"""
    state = ensure_workspace(db)
    return [str(key) for key in (state.section_order or [])]


__all__ = [
    "DEFAULT_GROUP_NAME",
    "active_custom_section_keys",
    "active_custom_sections",
    "active_group",
    "active_section_keys",
    "current_group",
    "ensure_workspace",
    "generate_external_id",
    "is_active_section_key",
    "repair_group_members",
    "repair_section_order",
    "section_order",
]
