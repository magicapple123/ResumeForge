# SPDX-License-Identifier: Apache-2.0
"""资料使用快照（profile_usage_snapshot，迁移 0064；F3 才写入）。

**为什么快照必须能脱离父行存活**（需求 R-33、契约 §2.8/§10.1）：生成任务与简历记录要
回答"这一次用的是哪个组、哪些大字段、什么顺序"。组可以改名/删除、任务与简历也可能被
清理，但历史必须仍可读。因此 task_id / resume_id 只做**逻辑引用，不建外键**：外键的
CASCADE / SET NULL 会改写历史（"当时用的组名"已冗余存在 group_name 里，正是为了父行
消失后仍能显示）。

**为什么没有 updated_at**：快照不可变——组名、参与清单、顺序、定义 revision、资料
revision、创建态布局都在创建瞬间冻结，之后组/定义/资料怎么变都不回写（R-34）。
本迁移只建结构，写入方在 F3 的生成链路里。

**为什么 definition_revision / data_revision 默认 0**：它们记录"快照生成时看到的定义与
数据修订号"；0 表示尚未记录（例如 F1 只有结构、还没有写入方），不要把它解释成"第 0 版"。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ProfileUsageSnapshot(Base):
    """一次生成/任务使用资料的不可变快照。"""

    __tablename__ = "profile_usage_snapshot"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定 id：uuid4().hex[:24]。
    snapshot_id: Mapped[str] = mapped_column(String(32), unique=True)
    # 逻辑引用 resume_generate_task.id / resume_record.id（不建外键，见模块 docstring）。
    # 一个任务/一份简历最多一条快照，所以各自 UNIQUE（SQLite 允许多个 NULL）。
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    resume_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    # 逻辑引用 profile_group.group_id；组已删时行仍在，展示用下面的 group_name。
    group_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 组名快照：组改名/删除后历史仍显示"当时用的组名"（R-33）。
    group_name: Mapped[str] = mapped_column(String(40))
    # [{key, name}]，按全局顺序（section_order）排列；只含参与的大字段。
    participating: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    section_order: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    definition_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    data_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 创建态来源布局（F4 用）；NULL = 未记录。
    layout: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 快照不可变：没有 updated_at。
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


__all__ = ["ProfileUsageSnapshot"]
