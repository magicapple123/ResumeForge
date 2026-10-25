# SPDX-License-Identifier: Apache-2.0
"""生成链路快照冻结：SSE 与后台任务在同一个入口冻结当前组消费快照（F3 §1）。

**为什么必须在创建任务时冻结**：当前组是可变状态（切组、改参与清单、删组/改名）。
若后台线程开始执行时再读"当前组"，排队期间的一次切组就会让任务来源漂移；而 R-33 要求
简历记录上的"本次使用：组名 + 参与清单"是**当时**的事实，组改名/删除后历史仍可读。
因此：请求到达时用 resolve_current_group_scope + load_consumed_profile 冻结不可变
dataclass，后续步骤只消费这份内存快照；同一时刻把元数据写进 profile_usage_snapshot
（任务 id / 组 / 参与清单 / 顺序 / 两枚修订 / layout），完成时把 resume_id 回写同一行
（与简历记录同事务）。

**layout 为什么单独冻结**：F4 的"新建简历"来源面板要显示创建态的参与分区与条目数；
它们是当时的数据，不能事后按当前资料重算。

**为什么不在快照表里存整份资料**：快照表只存追溯元数据；资料内容由 ConsumedProfile
在内存里跨线程传递。进程重启时未完成任务按既有恢复策略失败，不存在"半路重新读当前组"
的路径。

**definition_revision / data_revision 的口径**：前者 = scope.workspace_revision
（F1 起定义/顺序/当前组变更都会推进它）；后者 = 参与分区活动条目 revision 之和
（资料变更的确定性摘要）。两者只用于追溯/比对，不参与取数决策。

**resume_id / task_id 只是逻辑引用，而 SQLite 会复用被删掉的 rowid**：简历在回收站被
彻底删除后，它占过的 rowid 会被下一条新简历复用；旧快照行若仍保留这个 resume_id，
回写时就会撞 UNIQUE 约束（2026-10-26 用户真实库的新简历又拿到 644 即此形态）。因此
回收站彻底删除简历时主动解绑，绑定前再用 detach_snapshot_resume 兜底解绑同 id 的历史
行——只把逻辑引用置 NULL，快照其余字段仍不可变（R-34）。
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import func, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_entry import ProfileEntry
from ...models.profile_usage_snapshot import ProfileUsageSnapshot
from ...schemas.profile_projection import ConsumedProfile

if TYPE_CHECKING:  # pragma: no cover - 仅类型
    from ..profile.group_scope import ProfileScope

logger = logging.getLogger(__name__)

_ID_ATTEMPTS = 8


@dataclass(frozen=True)
class GenerationSnapshot:
    """一次生成冻结的不可变来源快照：只读、可跨线程/跨会话传递。"""

    scope: ProfileScope
    consumed: ConsumedProfile
    definition_revision: int
    data_revision: int
    layout: dict[str, Any]


def build_snapshot_layout(consumed: ConsumedProfile) -> dict[str, Any]:
    """创建态来源布局（F4 用）：参与分区 + 条目数 + 全局顺序的冻结副本。"""
    participating: list[dict[str, Any]] = []
    for key in consumed.participating_keys:
        section = consumed.section(key)
        if section is None:
            continue
        participating.append(
            {
                "key": key,
                "name": section.name,
                "form": section.form,
                "entry_count": len(section.entries),
                "material_only": section.material_only,
            }
        )
    return {
        "group_id": consumed.group_id,
        "group_name": consumed.group_name,
        "is_default": consumed.is_default,
        "section_order": list(consumed.section_order),
        "participating": participating,
    }


def consumed_has_content(consumed: ConsumedProfile) -> bool:
    """消费快照里是否有任何非空值（"只有有值基本信息也可生成"，R-32）。"""
    for section in consumed.sections.values():
        for entry in section.entries:
            if any(str(value or "").strip() for value in entry.values.values()):
                return True
    return False


def snapshot_entry_ids(consumed: ConsumedProfile) -> set[str]:
    """本次快照可见的条目 id 集合：生成入口用它筛选台账来源（F3 契约 §4）。"""
    return {
        entry.entry_id
        for section in consumed.sections.values()
        for entry in section.entries
        if entry.entry_id
    }


def _data_revision(db: Session, participating_keys: tuple[str, ...]) -> int:
    """参与分区活动条目 revision 之和：资料变更的确定性摘要（只用于追溯）。"""
    if not participating_keys:
        return 0
    total = (
        db.query(func.coalesce(func.sum(ProfileEntry.revision), 0))
        .filter(
            ProfileEntry.section_key.in_(list(participating_keys)),
            ProfileEntry.deleted_at.is_(None),
        )
        .scalar()
    )
    return int(total or 0)


def freeze_generation_snapshot(db: Session) -> GenerationSnapshot:
    """在数据集租约内冻结当前组消费快照（不写库；写库走 persist_generation_snapshot）。"""
    # 延迟导入：F2 的读取边界由并行任务交付；本模块在 application 的 import 链上，
    # 模块级 import 会在对方文件落地前让整仓 import 失败（联调期风险由延迟导入消除）。
    # 语义不变：仍然只调用 F2 的唯一实现，不在这里复制任何读取逻辑。
    from ..profile.group_scope import resolve_current_group_scope
    from ..profile.profile_reader import load_consumed_profile

    scope = resolve_current_group_scope(db)
    consumed = load_consumed_profile(db, scope)
    participating = tuple(consumed.participating_keys)
    return GenerationSnapshot(
        scope=scope,
        consumed=consumed,
        definition_revision=int(getattr(scope, "workspace_revision", 0) or 0),
        data_revision=_data_revision(db, participating),
        layout=build_snapshot_layout(consumed),
    )


def _unique_snapshot_id(db: Session) -> str:
    for _ in range(_ID_ATTEMPTS):
        candidate = uuid.uuid4().hex[:24]
        exists = (
            db.query(ProfileUsageSnapshot.id)
            .filter(ProfileUsageSnapshot.snapshot_id == candidate)
            .first()
        )
        if exists is None:
            return candidate
    raise RuntimeError("无法生成唯一的使用快照 id")


def snapshot_participating(consumed: ConsumedProfile) -> list[dict[str, str]]:
    """快照表 participating 列：按全局顺序的 [{key, name}]。"""
    result: list[dict[str, str]] = []
    for key in consumed.participating_keys:
        section = consumed.section(key)
        if section is not None:
            result.append({"key": key, "name": section.name})
    return result


def persist_generation_snapshot(
    db: Session, frozen: GenerationSnapshot, *, task_id: int | None = None
) -> ProfileUsageSnapshot:
    """写一行追溯快照（不提交，由调用方与任务/简历同事务提交）。

    同一 task_id 已存在快照时直接返回既有行（任务重试/重复创建不新增第二行；
    task_id 的 UNIQUE 约束是结构保证）。
    """
    if task_id is not None:
        existing = (
            db.query(ProfileUsageSnapshot).filter(ProfileUsageSnapshot.task_id == task_id).first()
        )
        if existing is not None:
            return existing
    consumed = frozen.consumed
    row = ProfileUsageSnapshot(
        snapshot_id=_unique_snapshot_id(db),
        task_id=task_id,
        resume_id=None,
        group_id=consumed.group_id or None,
        group_name=consumed.group_name,
        participating=snapshot_participating(consumed),
        section_order=list(consumed.section_order),
        definition_revision=int(frozen.definition_revision),
        data_revision=int(frozen.data_revision),
        layout=dict(frozen.layout),
        created_at=utcnow(),
    )
    db.add(row)
    db.flush()
    return row


def detach_snapshot_resume(
    db: Session, resume_id: int, *, keep_snapshot_id: int | None = None
) -> int:
    """把历史快照行的 resume_id 逻辑引用解除（置 NULL），返回解绑行数。

    **为什么必须存在**：resume_id 只是逻辑引用（本模块刻意不建外键，快照要能脱离父行
    存活），而 SQLite 的 INTEGER PRIMARY KEY 没有 AUTOINCREMENT——简历被彻底删除后，
    rowid 会被下一条新简历复用。旧快照行若仍占着同一个 resume_id，回写时就撞
    UNIQUE 约束（用户真实库 644 的 P0 故障）。这里**只改逻辑引用列**：
    snapshot_id / 组名 / 参与清单 / 顺序 / 两枚 revision / layout 全部原样保留，
    快照仍是"当时那次使用"的不可变历史（R-33/R-34）。

    keep_snapshot_id：本次要绑定的那一行自己不动（重复调用时它可能已经绑好）。
    """
    statement = update(ProfileUsageSnapshot).where(ProfileUsageSnapshot.resume_id == int(resume_id))
    if keep_snapshot_id is not None:
        statement = statement.where(ProfileUsageSnapshot.id != int(keep_snapshot_id))
    # DML 要读 `rowcount`；显式收窄成运行时真实类型（同 document_save.py）。
    result = cast("CursorResult[Any]", db.execute(statement.values(resume_id=None)))
    detached = int(result.rowcount or 0)
    if detached:
        logger.warning(
            "快照行的历史简历引用已解除（resume_id 被复用） resume_id=%s rows=%s",
            int(resume_id),
            detached,
        )
    return detached


def attach_snapshot_resume(
    db: Session, *, snapshot_id: int, resume_id: int, commit: bool = False
) -> bool:
    """把简历记录 id 回写到快照行（同事务；已回写过返回 False 但不再改写）。

    SQLite 会复用被彻底删除的 rowid：先确认目标行可绑定，再解除同 id 的历史悬空绑定，
    最后回写。目标行不存在或已绑定别的简历时保持旧语义（返回 False、不改写历史）。
    """
    row = db.get(ProfileUsageSnapshot, int(snapshot_id))
    if row is None:
        return False
    target_resume_id = int(resume_id)
    if row.resume_id is not None:
        return False
    detach_snapshot_resume(db, target_resume_id, keep_snapshot_id=int(snapshot_id))
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(ProfileUsageSnapshot)
            .where(
                ProfileUsageSnapshot.id == int(snapshot_id),
                ProfileUsageSnapshot.resume_id.is_(None),
            )
            .values(resume_id=target_resume_id)
            .execution_options(synchronize_session=False)
        ),
    )
    if commit:
        db.commit()
    return result.rowcount == 1


def snapshot_for_task(db: Session, task_id: int) -> ProfileUsageSnapshot | None:
    return (
        db.query(ProfileUsageSnapshot).filter(ProfileUsageSnapshot.task_id == int(task_id)).first()
    )


def snapshot_for_resume(db: Session, resume_id: int) -> ProfileUsageSnapshot | None:
    return (
        db.query(ProfileUsageSnapshot)
        .filter(ProfileUsageSnapshot.resume_id == int(resume_id))
        .first()
    )


def delete_generation_snapshot(db: Session, snapshot_id: int) -> None:
    """任务启动失败时撤销刚写的空快照（不留孤儿行；不提交）。"""
    row = db.get(ProfileUsageSnapshot, int(snapshot_id))
    if row is not None:
        db.delete(row)


__all__ = [
    "GenerationSnapshot",
    "attach_snapshot_resume",
    "build_snapshot_layout",
    "consumed_has_content",
    "delete_generation_snapshot",
    "detach_snapshot_resume",
    "freeze_generation_snapshot",
    "persist_generation_snapshot",
    "snapshot_for_resume",
    "snapshot_for_task",
    "snapshot_participating",
]
