# SPDX-License-Identifier: Apache-2.0
"""跟进巡检的决策：application_follow_up（迁移 0006）。

一行 = 用户对某个岗位的一次跟进决策。三个取值是一个**封闭决策集**，不是漏斗状态：

- contacted：我去联系/投过跟进；
- replied：对方已回（**只记录，不改** application_track.status —— 见下）；
- stopped：不跟了（永久排除，巡检不再为这个岗位建卡）。

**为什么不写 application_track**：decision 描述的是"用户对这张卡做了什么"，而
track.status 描述"对方走到哪一步了"。把 replied 映射成"筛选中"会在用户已手工推到
「面试」的记录上被 ``resolve_status()`` 原样吞掉——按钮点了没反应，比改错更难查。

``track_id`` 用 ``ON DELETE CASCADE``：进度记录被彻底删除后，它的跟进决策是孤儿数据，
没有保留价值；软删除（回收站）期间行保留，恢复后决策仍在。``task_id`` 刻意不建外键：
任务卡被清理后决策仍要能解释"当时为什么这么标"。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

FOLLOWUP_DECISION_CONTACTED = "contacted"
FOLLOWUP_DECISION_REPLIED = "replied"
FOLLOWUP_DECISION_STOPPED = "stopped"
FOLLOWUP_DECISIONS: tuple[str, ...] = (
    FOLLOWUP_DECISION_CONTACTED,
    FOLLOWUP_DECISION_REPLIED,
    FOLLOWUP_DECISION_STOPPED,
)


class ApplicationFollowUp(Base):
    """一条跟进决策（哪条进度、什么时候、做了什么决定）。"""

    __tablename__ = "application_follow_up"
    __table_args__ = (
        # 表内 CHECK：不用服务层兜底——绕过服务层直接写库的路径（导入/修复脚本）
        # 也要被数据库拒绝。
        CheckConstraint(
            "decision IN ('contacted','replied','stopped')",
            name="ck_application_follow_up_decision",
        ),
        # 巡检与详情页都按"这条进度的决策时间线"读，复合索引一次覆盖两列。
        Index("ix_application_follow_up_track_decided", "track_id", "decided_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 进度记录被彻底删除时决策跟着删（CASCADE）；软删除期间保留。
    track_id: Mapped[int] = mapped_column(
        ForeignKey("application_track.id", ondelete="CASCADE"), nullable=False
    )
    # 决策时刻（naive UTC，与全库口径一致），不是"该跟进的时间"。
    decided_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # contacted / replied / stopped（见模块顶部常量）。
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    # 用户当时看到/编辑过的草稿原文：留证据，不反推（空串 = 没起草稿）。
    draft_text: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    # 用户补充说明（如"电话聊过，等笔试"）。
    note: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    # 决策来自哪张任务卡：可空（历史/手动补录没有卡），刻意不加外键。
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


__all__ = [
    "ApplicationFollowUp",
    "FOLLOWUP_DECISIONS",
    "FOLLOWUP_DECISION_CONTACTED",
    "FOLLOWUP_DECISION_REPLIED",
    "FOLLOWUP_DECISION_STOPPED",
]
