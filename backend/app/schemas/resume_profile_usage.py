# SPDX-License-Identifier: Apache-2.0
"""简历「本次使用」追溯快照的只读响应模型（R-33）。

**为什么单独一个 schema 模块**：``schemas/resume.py`` 贴着 500 行预算，而这两组形状
（快照本身 + 是否已过时）同时服务两个出口——简历详情内嵌的 ``profile_usage`` 字段与
独立的 ``GET /api/resumes/{id}/profile-usage``。放回主文件会把"只读追溯元数据"和
简历正文契约混在一起，也让详情端点为了一个字段付出几十行 schema。

**口径**：全部只读、不可变；``definition_revision`` / ``data_revision`` 只是"保存/生成
那一刻看到的两枚修订号"，0 表示未记录，不参与任何取数决策，只用于提示是否需要重新生成。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# 快照之后发生的、会导致"纸面需要重新生成才体现"的变化类别（顺序即响应里的顺序）。
FreshnessReason = Literal["content_changed", "group_changed", "definition_changed"]


class ProfileUsageParticipating(BaseModel):
    """快照里冻结的一个参与大字段（``key`` 是稳定分区键，``name`` 是当时的显示名）。"""

    key: str
    name: str


class ProfileUsageOut(BaseModel):
    """一份简历保存/生成时冻结的"本次使用"元数据（R-33）。"""

    # 组名快照：组改名/删除后历史仍显示"当时用的组名"。
    group_name: str
    # 逻辑引用 profile_group.group_id；空 = 快照未记录组身份。
    group_id: str | None = None
    # 按全局顺序排列的参与大字段。
    participating: list[ProfileUsageParticipating] = Field(default_factory=list)
    section_order: list[str] = Field(default_factory=list)
    definition_revision: int = 0
    data_revision: int = 0
    created_at: datetime
    # 快照里的组已不在活动组里（被删除/在回收站）：仍显示快照，但要标注"组已删除"。
    group_deleted: bool = False


class ProfileUsageFreshness(BaseModel):
    """快照之后资料/组定义是否变过：``changed`` 为真时界面提示需重新生成。"""

    changed: bool = False
    reasons: list[FreshnessReason] = Field(default_factory=list)


class ResumeProfileUsageOut(BaseModel):
    """``GET /api/resumes/{id}/profile-usage`` 的响应体。

    ``profile_usage`` 为空 = 旧简历/未带来源信息的手写简历（不报错）；
    此时 ``freshness.changed`` 恒为 false——没有快照就没有可比对的基准。
    """

    profile_usage: ProfileUsageOut | None = None
    freshness: ProfileUsageFreshness = Field(default_factory=ProfileUsageFreshness)


__all__ = [
    "FreshnessReason",
    "ProfileUsageFreshness",
    "ProfileUsageOut",
    "ProfileUsageParticipating",
    "ResumeProfileUsageOut",
]
