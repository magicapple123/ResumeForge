# SPDX-License-Identifier: Apache-2.0
"""资料组接口：列表/新建/改名/删除、参与清单、当前组切换、降级告知确认。

职责边界（R-17/R-24）：组只是"名称 + 参与清单"，**任何组操作都不写资料条目**；
当前组是数据集级唯一状态，PUT /current-group 是唯一切换入口——生成面板与其它页面
只读"当前组"快照，不提供第二个切换接口（否则两个入口并发切组会出现两套真相）。

序列化辅助 group_brief_out / group_out / state_out 也放在这里：工作区读取、组列表、
切组响应共用同一形状（participating_keys 永远是服务端按全局顺序解析后的结果，R-08/R-22）。

本模块不捕获 StoreError：错误由 application.py 统一注册的处理器转成
{detail, code, ...extra}（409 带 revision），保证三个新路由的错误契约完全一致。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.profile_groups import (
    CurrentGroupIn,
    GroupBriefOut,
    GroupCreateIn,
    GroupDeleteOut,
    GroupListOut,
    GroupMembersIn,
    GroupOut,
    GroupUpdateIn,
    NoticeAckOut,
    RevisionIn,
)
from ..schemas.profile_workspace import PendingNoticeOut, WorkspaceStateOut
from ..services.profile import group_store
from ..services.profile.workspace_bootstrap import DEFAULT_GROUP_NAME

router = APIRouter(prefix="/api/profile", tags=["profile-groups"])


def group_brief_out(db: Session, group: Any) -> GroupBriefOut:
    """组的只读摘要：参与清单已按全局 section_order 排序、basic_info 恒在首位。"""
    keys = group_store.group_participating_keys(db, group)
    return GroupBriefOut(
        group_id=group.group_id,
        name=group.name,
        is_default=bool(group.is_default),
        # 名字仍是内置默认名（用户没改过）→ 前端可以把它翻成当前界面语言；
        # 改过名之后原样显示用户输入，那是数据，不是文案。
        name_is_default=bool(group.is_default) and group.name == DEFAULT_GROUP_NAME,
        revision=group.revision,
        participating_keys=keys,
        member_count=len(keys),
    )


def group_out(db: Session, group: Any) -> GroupOut:
    """组列表用的完整只读形状（多出创建/更新时间）。"""
    brief = group_brief_out(db, group)
    return GroupOut(
        **brief.model_dump(),
        created_at=getattr(group, "created_at", None),
        updated_at=getattr(group, "updated_at", None),
    )


def state_out(state: Any) -> WorkspaceStateOut:
    """工作区状态形状：全局顺序、当前/默认组指针、revision、待展示降级事件。"""
    notice = None
    raw = getattr(state, "pending_notice", None)
    if raw:
        data = dict(raw) if isinstance(raw, dict) else {}
        notice = PendingNoticeOut(
            notice_id=str(getattr(state, "notice_id", "") or data.get("notice_id") or ""),
            kind=str(data.get("kind") or ""),
            group_id=data.get("group_id"),
            group_name=data.get("group_name"),
            message=data.get("message"),
        )
    return WorkspaceStateOut(
        section_order=list(getattr(state, "section_order", None) or []),
        current_group_id=state.current_group_id,
        default_group_id=state.default_group_id,
        workspace_revision=state.revision,
        pending_notice=notice,
    )


@router.get("/groups", response_model=GroupListOut)
def list_groups(db: Session = Depends(get_db)) -> GroupListOut:
    """活动组列表（默认组在前）+ 当前组 + 工作区 revision。"""
    state = group_store.read_state(db)
    groups = group_store.list_groups(db)
    return GroupListOut(
        items=[group_out(db, group) for group in groups],
        current_group_id=state.current_group_id,
        default_group_id=state.default_group_id,
        workspace_revision=state.revision,
    )


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(payload: GroupCreateIn, db: Session = Depends(get_db)) -> GroupOut:
    """新建组（名称唯一、活动组 ≤20）；参与清单为空是合法状态（R-18/R-23）。"""
    group = group_store.create_group(db, payload.name)
    return group_out(db, group)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def rename_group(group_id: str, payload: GroupUpdateIn, db: Session = Depends(get_db)) -> GroupOut:
    """改名（默认组也可改名，但不可删除，R-20）。"""
    group = group_store.rename_group(
        db, group_id, payload.name, expected_revision=payload.expected_revision
    )
    return group_out(db, group)


@router.delete("/groups/{group_id}", response_model=GroupDeleteOut)
def delete_group(
    group_id: str, payload: RevisionIn, db: Session = Depends(get_db)
) -> GroupDeleteOut:
    """软删组（只删清单，不动资料）；删的是当前组时同事务切回默认组并留下降级告知。"""
    result = group_store.delete_group(db, group_id, expected_revision=payload.expected_revision)
    current = None
    switched_to = result.get("switched_to")
    if switched_to:
        switched = group_store.get_group(db, switched_to)
        if switched is not None:
            current = group_brief_out(db, switched)
    return GroupDeleteOut(
        deleted_group_id=result["deleted_group_id"],
        switched_to=switched_to,
        notice_id=result.get("notice_id"),
        current_group=current,
    )


@router.put("/groups/{group_id}/members", response_model=GroupOut)
def set_group_members(
    group_id: str, payload: GroupMembersIn, db: Session = Depends(get_db)
) -> GroupOut:
    """整份替换参与清单：只增删关系行；basic_info 由服务端强制补回（R-21）。"""
    group_store.set_group_members(
        db,
        group_id,
        payload.section_keys,
        expected_revision=payload.expected_revision,
    )
    group = group_store.get_group(db, group_id)
    if group is None:  # 上一行刚校验过存在，这里只是防御
        raise LookupError("组不存在或已删除")
    return group_out(db, group)


@router.put("/current-group", response_model=WorkspaceStateOut)
def switch_current_group(
    payload: CurrentGroupIn, db: Session = Depends(get_db)
) -> WorkspaceStateOut:
    """唯一切换入口（R-24）：目标必须是活动组，写成功后返回最新状态。"""
    state = group_store.switch_current_group(
        db, payload.group_id, expected_revision=payload.expected_revision
    )
    return state_out(state)


@router.post("/notices/{notice_id}/ack", response_model=NoticeAckOut)
def acknowledge_notice(notice_id: str, db: Session = Depends(get_db)) -> NoticeAckOut:
    """确认当前组降级事件（R-25）：只清匹配的这条，不匹配返回 acknowledged=false。"""
    return NoticeAckOut(acknowledged=group_store.ack_notice(db, notice_id))
