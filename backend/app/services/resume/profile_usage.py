# SPDX-License-Identifier: Apache-2.0
"""简历「本次使用」追溯视图与过时判定（R-33；R-36 相邻口径）。

**为什么单独成模块**：快照表只存元数据，但"怎么把它变成接口形状"（组名/参与清单/
组是否已删除）与"资料或定义变了没有"的判定必须只有一份实现——简历详情内嵌字段与
独立 GET 端点都从这里取数，前端才能看到同一口径的「本次使用」。

**为什么 freshness 只读不写**：它只回答"现在重新生成会不会得到不同的纸面"，**不重新
生成、不改正文、不回写快照**（R-33/R-34：已保存简历不会因切组/改资料而变化）。

**为什么复用 generate_snapshot 的 revision 口径**：写快照时 ``data_revision`` 用
``_data_revision`` 计算，读侧若另写一份求和，两边口径迟早漂移（例如漏掉软删过滤），
于是"没变"被误判成"变了"。这里直接复用同一函数，不复制逻辑。
"""

from __future__ import annotations

import logging

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ...models.profile_usage_snapshot import ProfileUsageSnapshot
from ...schemas.profile_editor import EditorSchemaOut
from ...schemas.resume_profile_usage import (
    FreshnessReason,
    ProfileUsageFreshness,
    ProfileUsageOut,
    ProfileUsageParticipating,
    ResumeProfileUsageOut,
)
from ..profile import group_store
from ..profile.errors import Conflict
from ..profile.group_scope import resolve_current_group_scope
from .generate_snapshot import _data_revision, snapshot_for_resume

logger = logging.getLogger(__name__)


def _participating(snapshot: ProfileUsageSnapshot) -> list[ProfileUsageParticipating]:
    """快照 participating 列的展示形状（容忍历史/外部写入的残缺项，不抛 500）。"""
    items: list[ProfileUsageParticipating] = []
    for raw in snapshot.participating or []:
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key") or "").strip()
        if not key:
            continue
        items.append(ProfileUsageParticipating(key=key, name=str(raw.get("name") or key)))
    return items


def _editor_schema(snapshot: ProfileUsageSnapshot) -> EditorSchemaOut | None:
    """读取快照 layout 里冻结的编辑器视图（F10/R-82）；旧快照/坏数据一律 None。

    旧快照的 layout 没有这个键；外部写入或历史版本也可能留下非 dict / 不合法的结构。
    它只是展示用的辅助信息，不能因为一条可疑数据让简历详情或独立端点 500（R-33 的
    只读追溯口径：没有就如实返回 null）。
    """
    layout = snapshot.layout
    if not isinstance(layout, dict):
        return None
    raw = layout.get("editor_schema")
    if not isinstance(raw, dict):
        return None
    try:
        return EditorSchemaOut.model_validate(raw)
    except ValidationError:
        return None


def _group_deleted(db: Session, group_id: str | None) -> bool:
    """快照里的组是否已不在活动组里（删除/在回收站）。``group_id`` 空 = 未记录。"""
    if not group_id:
        return False
    # 只读查询：get_group 默认把回收站里的当作不存在，且不会触发 ensure/修复。
    return group_store.get_group(db, group_id) is None


def build_profile_usage(db: Session, snapshot: ProfileUsageSnapshot) -> ProfileUsageOut:
    """把一行快照转成只读接口形状（组名/参与清单/顺序/两枚修订/是否已删组）。"""
    group_id = (snapshot.group_id or "").strip() or None
    return ProfileUsageOut(
        group_name=snapshot.group_name,
        group_id=group_id,
        participating=_participating(snapshot),
        section_order=[str(key) for key in (snapshot.section_order or [])],
        definition_revision=int(snapshot.definition_revision or 0),
        data_revision=int(snapshot.data_revision or 0),
        created_at=snapshot.created_at,
        group_deleted=_group_deleted(db, group_id),
        editor_schema=_editor_schema(snapshot),
    )


def profile_usage_for_resume(db: Session, resume_id: int) -> ProfileUsageOut | None:
    """简历详情补字段用：无快照（旧简历/手写简历）返回 None，不报错。"""
    snapshot = snapshot_for_resume(db, resume_id)
    if snapshot is None:
        return None
    return build_profile_usage(db, snapshot)


def _freshness(db: Session, snapshot: ProfileUsageSnapshot) -> ProfileUsageFreshness:
    """快照之后资料/组/定义是否变过。组不可用时降级为"未判定"，不阻断详情。"""
    try:
        scope = resolve_current_group_scope(db)
    except Conflict:
        # 当前组数据被外部改坏：这条提示只是辅助信息，报错比沉默更糟（详情会整块失败）。
        logger.warning("资料使用快照过时判定跳过：当前组不可用 resume_id=%s", snapshot.resume_id)
        return ProfileUsageFreshness()
    snapshot_keys = tuple(item.key for item in _participating(snapshot))
    reasons: list[FreshnessReason] = []
    if _data_revision(db, snapshot_keys) != int(snapshot.data_revision or 0):
        reasons.append("content_changed")
    snapshot_group = (snapshot.group_id or "").strip()
    if snapshot_group and (
        snapshot_group != scope.group_id or snapshot_keys != tuple(scope.participating_keys)
    ):
        reasons.append("group_changed")
    if int(snapshot.definition_revision or 0) != int(scope.workspace_revision or 0):
        reasons.append("definition_changed")
    return ProfileUsageFreshness(changed=bool(reasons), reasons=reasons)


def profile_usage_response(db: Session, resume_id: int) -> ResumeProfileUsageOut:
    """独立端点的响应：快照 + 过时判定；无快照时两者都为空/False（不报错）。"""
    snapshot = snapshot_for_resume(db, resume_id)
    if snapshot is None:
        return ResumeProfileUsageOut()
    return ResumeProfileUsageOut(
        profile_usage=build_profile_usage(db, snapshot),
        freshness=_freshness(db, snapshot),
    )


__all__ = [
    "build_profile_usage",
    "profile_usage_for_resume",
    "profile_usage_response",
]
