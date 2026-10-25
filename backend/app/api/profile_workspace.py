# SPDX-License-Identifier: Apache-2.0
"""资料工作区接口：编辑视图读取、多分区批量保存、全局顺序、自建大字段与条目 CRUD。

**为什么有一个"工作区读取"聚合接口**：资料页一次要拿齐"定义 + 全局顺序 + 当前组 +
条目 + 偏好 + revision"。拆成 5 个请求会让页面在慢网络下出现"定义到了、条目没到"的
半渲染态，也会让前端自己拼一致性（前端拼出来的顺序与服务端解析出的组顺序可能不同）。

**批量保存是唯一的多分区写入口**（R-15）：条目与字段定义版本在一次事务里校验后原子提交，
任一失败全部回滚；"未渲染字段缺席"不是删除信号（这里只做合并语义，删除走显式 PATCH 空串）。

**删除类请求带 expected_revision**：删自建大字段/条目都会改 revision，条件不符返回 409；
删定义只下线可见性，不清空条目与值（R-06/R-13），恢复走既有回收站。

错误由 application.py 统一注册的 StoreError 处理器映射为 {detail, code, ...}，
本模块不写 HTTPException 文案，保证与组/定义模块同一套错误契约。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.profile import ProfilePhoto
from ..schemas.profile_projection import (
    PaperProjectionOut,
    UpgradeStatusOut,
    WorkspaceUpgradeFieldOut,
)
from ..schemas.profile_workspace import (
    BulkEntriesIn,
    BulkEntriesOut,
    EntryCreateIn,
    EntryOut,
    EntryUpdateIn,
    LimitsOut,
    ReorderIn,
    RevisionIn,
    SectionCreateIn,
    SectionDeletionImpactOut,
    SectionOrderIn,
    SectionOut,
    SectionUpdateIn,
    WorkspaceOut,
    WorkspaceStateOut,
)
from ..services.profile import (
    definition_store,
    entry_store,
    group_store,
    profile_reader,
    value_validation,
)
from ..services.profile.group_scope import resolve_current_group_scope
from ..services.profile.paper_projection import build_projection
from .profile_definitions import section_out
from .profile_groups import group_brief_out, state_out

router = APIRouter(prefix="/api/profile", tags=["profile-workspace"])


def entry_out(entry: Any) -> EntryOut:
    """条目只读形状：values 的键是稳定 field_id，缺失键表示"本次未提交"。"""
    return EntryOut(
        entry_id=entry.entry_id,
        section_key=entry.section_key,
        sort_order=entry.sort_order,
        values=dict(entry.values or {}),
        revision=entry.revision,
        created_at=getattr(entry, "created_at", None),
        updated_at=getattr(entry, "updated_at", None),
    )


def _limits() -> LimitsOut:
    """服务端真实上限：前端只用它做提示，不自行裁断（R-03/R-11/R-18）。"""
    return LimitsOut(
        max_entries_per_section=value_validation.MAX_ENTRIES_PER_SECTION,
        max_custom_fields_per_section=value_validation.MAX_CUSTOM_FIELDS_PER_SECTION,
        max_groups=value_validation.MAX_GROUPS,
        single_line_chars=value_validation.MAX_SINGLE_LINE_CHARS,
        multi_line_chars=value_validation.MAX_MULTI_LINE_CHARS,
    )


def _photo_resolver(db: Session):
    """照片资源引用 → data URL（投影层自己透传 data URL，这里只解析库内照片 id）。

    支持 "profile_photo:<id>" / "photo:<id>" / 纯数字 id；解析不了返回 None，让投影层
    记 photo_unresolved warning，而不是阻塞整份投影（照片坏一张不该让简历打不开）。
    """

    def resolve(reference: str) -> str | None:
        value = str(reference or "").strip()
        if value.startswith(("profile_photo:", "photo:")):
            value = value.split(":", 1)[1].strip()
        if not value.isdigit():
            return None
        photo = db.get(ProfilePhoto, int(value))
        return photo.image if photo is not None and photo.image else None

    return resolve


def _workspace_out(db: Session) -> WorkspaceOut:
    """把定义/组/条目/偏好/状态组装成一份一致的编辑视图（顺序全部来自服务端）。"""
    sections = definition_store.list_sections(db)
    groups = group_store.list_groups(db)
    state = group_store.read_state(db)
    briefs = [group_brief_out(db, group) for group in groups]
    current = next((item for item in briefs if item.group_id == state.current_group_id), None)
    entries = entry_store.list_entries(db)
    has_legacy, new_has_entries = profile_reader.load_workspace_upgrade_status(db)
    return WorkspaceOut(
        sections=[section_out(section) for section in sections],
        section_order=list(state.section_order or []),
        current_group=current,
        groups=briefs,
        entries=[entry_out(entry) for entry in entries],
        workspace_revision=state.revision,
        pending_notice=state_out(state).pending_notice,
        upgrade=WorkspaceUpgradeFieldOut(
            has_legacy_data=has_legacy,
            new_profile_has_entries=new_has_entries,
        ),
        limits=_limits(),
    )


@router.get("/workspace", response_model=WorkspaceOut)
def read_workspace(db: Session = Depends(get_db)) -> WorkspaceOut:
    """资料页编辑视图：首次访问会自动建立默认组/状态（bootstrap 幂等）。"""
    return _workspace_out(db)


@router.get("/upgrade-status", response_model=UpgradeStatusOut)
def read_upgrade_status(db: Session = Depends(get_db)) -> UpgradeStatusOut:
    """R-47 升级检测：旧表有内容且新模型为空时，资料页展示"旧资料不再显示"说明。

    只返回布尔状态；新模型已有实际内容时不再探测旧表（提示按条件自然消失）。
    """
    has_legacy, new_has_entries = profile_reader.load_workspace_upgrade_status(db)
    return UpgradeStatusOut(
        has_legacy_data=has_legacy,
        new_profile_has_entries=new_has_entries,
    )


@router.get("/current/projection", response_model=PaperProjectionOut)
def read_current_projection(db: Session = Depends(get_db)) -> PaperProjectionOut:
    """当前组的纸面投影：内容/候选/来源布局/警告唯一由服务端确定性生成（R-37/R-79）。

    投影组装在 services/profile/paper_projection.py（纸面策略的唯一来源）；这里只负责
    "解析当前组 → 读消费快照 → 交给投影"，不在这里重写任何承载区/标签规则。
    """
    consumed = profile_reader.load_consumed_profile(db, resolve_current_group_scope(db))
    return build_projection(consumed, resolve_photo=_photo_resolver(db))


@router.patch("/workspace/entries", response_model=BulkEntriesOut)
def save_workspace_entries(payload: BulkEntriesIn, db: Session = Depends(get_db)) -> BulkEntriesOut:
    """保存本轮多分区改动集：单事务原子提交，失败一条也不写（R-15）。"""
    entries = entry_store.bulk_save_entries(
        db,
        [item.model_dump() for item in payload.entries],
        expected_workspace_revision=payload.expected_workspace_revision,
    )
    state = group_store.read_state(db)
    return BulkEntriesOut(
        entries=[entry_out(entry) for entry in entries],
        workspace_revision=state.revision,
    )


@router.put("/section-order", response_model=WorkspaceStateOut)
def update_section_order(
    payload: SectionOrderIn, db: Session = Depends(get_db)
) -> WorkspaceStateOut:
    """全局唯一顺序（R-08）：服务端校验基本信息首位与自建分区固定尾部。"""
    state = group_store.set_section_order(
        db, payload.order, expected_revision=payload.expected_revision
    )
    return state_out(state)


@router.post("/sections", response_model=SectionOut, status_code=201)
def create_custom_section(payload: SectionCreateIn, db: Session = Depends(get_db)) -> SectionOut:
    """新建自建大字段（形态固定多条），同一事务加入当前组（R-04）。"""
    section = definition_store.create_custom_section(
        db, payload.name, expected_state_revision=payload.expected_revision
    )
    return section_out(section)


@router.patch("/sections/{section_key}", response_model=SectionOut)
def rename_custom_section(
    section_key: str, payload: SectionUpdateIn, db: Session = Depends(get_db)
) -> SectionOut:
    """自建大字段改名；内置定义拒绝（R-05/R-12）。"""
    section = definition_store.rename_custom_section(
        db, section_key, payload.name, expected_revision=payload.expected_revision
    )
    return section_out(section)


@router.delete("/sections/{section_key}", response_model=SectionDeletionImpactOut)
def delete_custom_section(
    section_key: str, payload: RevisionIn, db: Session = Depends(get_db)
) -> SectionDeletionImpactOut:
    """软删自建大字段：条目与值保留、组关系保留（供撤销），恢复走回收站（R-06）。"""
    impact = definition_store.delete_custom_section(
        db, section_key, expected_revision=payload.expected_revision
    )
    return SectionDeletionImpactOut(**impact)


@router.get("/sections/{section_key}/deletion-impact", response_model=SectionDeletionImpactOut)
def read_section_deletion_impact(
    section_key: str, db: Session = Depends(get_db)
) -> SectionDeletionImpactOut:
    """删除前的影响面：多少条记录将不再显示但会保留（R-07）。"""
    return SectionDeletionImpactOut(**definition_store.section_deletion_impact(db, section_key))


@router.post("/sections/{section_key}/entries", response_model=EntryOut, status_code=201)
def create_entry(
    section_key: str, payload: EntryCreateIn, db: Session = Depends(get_db)
) -> EntryOut:
    """新增条目；单例分区（basic_info/summary）自动收敛成 upsert，绝不建第二条。"""
    entry = entry_store.upsert_entry(
        db,
        section_key,
        values=dict(payload.values),
        sort_order=payload.sort_order,
        expected_revision=payload.expected_revision,
    )
    return entry_out(entry)


@router.patch("/sections/{section_key}/entries/{entry_id}", response_model=EntryOut)
def update_entry(
    section_key: str,
    entry_id: str,
    payload: EntryUpdateIn,
    db: Session = Depends(get_db),
) -> EntryOut:
    """条件更新：values 只提交本次改动字段，未提交键保留旧值（含 hidden/已删字段）。"""
    values = (
        dict(payload.values)
        if "values" in payload.model_fields_set and payload.values is not None
        else None
    )
    entry = entry_store.upsert_entry(
        db,
        section_key,
        entry_id=entry_id,
        values=values,
        sort_order=payload.sort_order,
        expected_revision=payload.expected_revision,
    )
    return entry_out(entry)


@router.delete("/sections/{section_key}/entries/{entry_id}", status_code=204)
def delete_entry(
    section_key: str,
    entry_id: str,
    payload: RevisionIn,
    db: Session = Depends(get_db),
) -> None:
    """软删条目（可撤销）；删中间条目不重排其余条目（R-03）。"""
    entry_store.delete_entry(db, section_key, entry_id, expected_revision=payload.expected_revision)


@router.put("/sections/{section_key}/entries/reorder", response_model=list[EntryOut])
def reorder_entries(
    section_key: str, payload: ReorderIn, db: Session = Depends(get_db)
) -> list[EntryOut]:
    """多条分区内重排：entry_ids 必须恰好是该分区全部活动条目（服务端校验）。"""
    entries = entry_store.reorder_entries(
        db,
        section_key,
        payload.entry_ids,
        expected_revision=payload.expected_revision,
    )
    return [entry_out(entry) for entry in entries]
