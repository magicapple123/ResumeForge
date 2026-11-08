# SPDX-License-Identifier: Apache-2.0
"""求职偏好档：job_preference（迁移 0008）。

一行 = 用户确认过的一次完整取值（"杭州、上海；别写赋能"落成城市 + 禁用词两行，不是
逐词多行）——这样"一键撤销"撤的是一次确认，而不是一个词。

三个语义轴刻意分开，不要合并：

- ``state``：版本状态（active / superseded / undone），描述"这一版还算不算当前值"；
- ``deleted_at``：**只表示用户删了它**（进回收站），不兼作版本状态；
- ``source``：这条偏好从哪来（用户陈述 / 用户编辑 / 导入）——**不含 assistant**，
  模型不能凭一句"已记住"就把偏好写进库（写入必须走已执行的提案）。

**为什么``deleted_at``不能兼作版本状态**：全库软删表的 ``deleted_at`` 只有一个含义，
回收站的判据就是它非空。一旦版本替换也写它，每改一次偏好就往回收站扔一条，回收站
（全库最不能出错的一层）会立刻失真。所以编辑只把旧行置 superseded、撤销只置 undone。

**活动行唯一性用 partial unique index**：``(dataset_key, kind)`` 只约束
``state='active' AND deleted_at IS NULL`` 的活动行，superseded / 回收站里的行都能
与活动行并存。恢复撞上活动行时由 services/trash.py 提前翻译成 409，而不是让数据库
抛 IntegrityError 变成用户看不懂的 500。

**为什么没有 12 类目录**：kind 的闭集目录与逐 kind 值校验器在服务层
（services/job_preference_catalog.py）；本模型只存协议值，不引入第二份目录副本。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# ===== 版本状态（三档；没有 deleted——删除由 deleted_at 表达） =====
PREF_STATE_ACTIVE = "active"
PREF_STATE_SUPERSEDED = "superseded"
PREF_STATE_UNDONE = "undone"
PREF_STATES: tuple[str, ...] = (PREF_STATE_ACTIVE, PREF_STATE_SUPERSEDED, PREF_STATE_UNDONE)

# ===== 来源（闭集，**不含 assistant**） =====
PREF_SOURCE_USER_STATED = "user_stated"
PREF_SOURCE_USER_EDITED = "user_edited"
PREF_SOURCE_IMPORTED = "imported"
PREF_SOURCES: tuple[str, ...] = (
    PREF_SOURCE_USER_STATED,
    PREF_SOURCE_USER_EDITED,
    PREF_SOURCE_IMPORTED,
)

# ===== 值形态（list 存数组，scalar 存小对象） =====
PREF_VALUE_KIND_LIST = "list"
PREF_VALUE_KIND_SCALAR = "scalar"
PREF_VALUE_KINDS: tuple[str, ...] = (PREF_VALUE_KIND_LIST, PREF_VALUE_KIND_SCALAR)


class JobPreference(Base):
    """一条用户设定（不是"发生过的事实"），只作助手行为约束，不上纸面、不进事实台账。"""

    __tablename__ = "job_preference"
    __table_args__ = (
        UniqueConstraint("pref_id", name="uq_job_preference_pref_id"),
        CheckConstraint("value_kind IN ('list','scalar')", name="ck_job_preference_value_kind"),
        CheckConstraint(
            "source IN ('user_stated','user_edited','imported')",
            name="ck_job_preference_source",
        ),
        CheckConstraint(
            "state IN ('active','superseded','undone')",
            name="ck_job_preference_state",
        ),
        # 活动行唯一：同 dataset_key + kind 同时只能有一条 active 且未删除的行。
        # 软删除/版本替换都不占位，所以回收站里的行与历史版本可以并存。
        Index(
            "ux_job_preference_active_kind",
            "dataset_key",
            "kind",
            unique=True,
            sqlite_where=text("state = 'active' AND deleted_at IS NULL"),
        ),
        # 列表/详情按 dataset_key + kind 过滤后再按 state 筛，复合索引一次覆盖。
        Index("ix_job_preference_kind_state", "dataset_key", "kind", "state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定 id：uuid4().hex[:24]，对外只认它，不认自增主键。
    pref_id: Mapped[str] = mapped_column(String(32), nullable=False)
    # 数据集隔离键：与 agent_task 等表同一口径（main / 16 位 hex id）。
    dataset_key: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # 闭集目录 key（12 类，定义在服务层，不落库）。
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    # list / scalar（见模块顶部常量），决定 value 的形状。
    value_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    # list 存数组、scalar 存小对象；结构由 value_schema 解释。
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    # canonical sha256，幂等键：同 kind 同值的写入直接 no-op（不产生新版本）。
    value_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    # 值形态代：将来把 value 升成 [{item, added_at, source}] 时升版本号，列不动。
    value_schema: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    # user_stated / user_edited / imported（见模块顶部常量）；user_stated 时服务层强制
    # source_proposal_id 非空（必须有一条已执行的提案）。
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    source_proposal_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 用户原话摘录：解释"为什么记成这条"，不存整段对话。
    note: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    # active / superseded / undone（见模块顶部常量）。
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default=PREF_STATE_ACTIVE, server_default=PREF_STATE_ACTIVE
    )
    # **只表示用户删除**（进回收站），不兼作版本状态：版本替换/撤销一律不写这一列。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


__all__ = [
    "JobPreference",
    "PREF_SOURCES",
    "PREF_SOURCE_IMPORTED",
    "PREF_SOURCE_USER_EDITED",
    "PREF_SOURCE_USER_STATED",
    "PREF_STATES",
    "PREF_STATE_ACTIVE",
    "PREF_STATE_SUPERSEDED",
    "PREF_STATE_UNDONE",
    "PREF_VALUE_KINDS",
    "PREF_VALUE_KIND_LIST",
    "PREF_VALUE_KIND_SCALAR",
]
