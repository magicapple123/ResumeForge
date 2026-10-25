# SPDX-License-Identifier: Apache-2.0
"""组、组成员与当前组状态（profile_group / profile_group_member / profile_workspace_state）。

**组不拥有数据**（需求 R-17、§6 铁律 1/2）：组只记录"名称 + 参与的大字段 key 集合"；
资料内容全在 profile_entry，任何组内编辑立刻对所有组可见，不存在"每组副本"或组内覆盖值。
删除组只软删组行、不动任何资料行，也不动自建大字段定义。

**为什么当前组是单行状态表**（需求 R-24、§6 铁律 6）：当前组是数据集级唯一状态，必须
持久化且不允许"无当前组 / 多个当前组"的中间态。单行表 + CHECK(id = 1) 让"第二行当前组"
在数据库层就写不进去；当前组被删时由服务层在同一事务里切回默认组并写 pending_notice
（R-25），不存在把 current_group_id 置空的降级路径。

**为什么组参与关系没有 deleted_at**（契约 §2.5）：组软删时关系保留供撤销（恢复组后
参与清单原样回来）；彻底删除组时由回收站策略清理关系行。关系行不是用户内容，不进回收站，
也不该在组软删期间让"组里有 13 项"变成"0 项"——否则撤销回来会丢参与清单。

**为什么默认组不可删要靠 CHECK 而不是只靠服务层**（契约 §2.4 / R-20）：需求要求默认组
恒存在且不可删除。CHECK `is_default = 0 OR deleted_at IS NULL` 让"软删默认组"直接写不进
库；partial unique 再保证活动组里最多一个 is_default = 1——两道结构约束，不依赖调用方自觉。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ProfileGroup(Base):
    """一个组：名称 + 参与清单（清单在 ProfileGroupMember）。"""

    __tablename__ = "profile_group"
    __table_args__ = (
        # 默认组不可软删：删除默认组只可能是服务层缺陷，宁可写库失败也不要静默造出
        # "没有默认组"的状态。
        CheckConstraint(
            "is_default = 0 OR deleted_at IS NULL",
            name="ck_profile_group_default_not_deleted",
        ),
        # 活动组名称唯一（name_key 归一化后）；软删组不占名，可被新组复用。
        Index(
            "ux_profile_group_active_name",
            "name_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
        # 活动组里最多一个默认组：is_default=1 的行才进索引，再唯一即最多一条。
        Index(
            "ux_profile_group_single_default",
            "is_default",
            unique=True,
            sqlite_where=text("is_default = 1 AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定 id：uuid4().hex[:24]；改名/换参与清单都不改变它。
    group_id: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    # normalize_name_key(name)：唯一性只看归一化键，展示仍用原 name。
    name_key: Mapped[str] = mapped_column(String(40))
    # 默认组恒存在、不可删除（结构约束见 __table_args__）；bootstrap 负责创建。
    is_default: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


class ProfileGroupMember(Base):
    """组 ↔ 大字段的参与关系（只在/不在，组内没有顺序）。"""

    __tablename__ = "profile_group_member"

    # 复合主键即"同一个组里同一个分区只能有一行"，不需要额外的唯一约束。
    group_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    section_key: Mapped[str] = mapped_column(String(48), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ProfileWorkspaceState(Base):
    """数据集级单行状态：当前组、默认组、全局分区顺序、待告知事项。"""

    __tablename__ = "profile_workspace_state"
    __table_args__ = (
        # 单行表：id 只能是 1。"多一行当前组"在数据库层就写不进去。
        CheckConstraint("id = 1", name="ck_profile_workspace_state_single_row"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 逻辑引用 profile_group.group_id（不建外键：组软删后关系仍保留，由服务层校验有效性）。
    current_group_id: Mapped[str] = mapped_column(String(32))
    default_group_id: Mapped[str] = mapped_column(String(32))
    # 全局唯一顺序：内置 13 条 + 自建分区，basic_info 恒首位（服务层校验，R-08 / §6 铁律 9）。
    section_order: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    # 待告知事项：{"kind","group_id","group_name","message?"}；前端展示后按 notice_id 确认。
    pending_notice: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    notice_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


__all__ = ["ProfileGroup", "ProfileGroupMember", "ProfileWorkspaceState"]
