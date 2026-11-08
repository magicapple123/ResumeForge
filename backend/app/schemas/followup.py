# SPDX-License-Identifier: Apache-2.0
"""期一新增接口的请求/响应结构：跟进巡检决策 + 「我已提交」。

两类 DTO 放在同一个新模块里，是因为它们属于**同一批**（期一）新增的对外契约，
且都要保持 ``extra="forbid"`` 与"稳定码原样下发、展示名走前端语言包"的口径。
契约定稿见 ``D:/rf_verify/contracts/CONTRACTS.md`` 的 A/B 两节。

跟进决策的取值来自 ``models.followup.FOLLOWUP_DECISIONS``（封闭决策集，不是漏斗
状态）；这里只做接口层校验，**不做状态映射**——"对方已回"绝不写
``application_track.status``，理由见 models/followup.py 的模块注释。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models.followup import FOLLOWUP_DECISIONS

#: 一张卡最多几个决策：与巡检单卡上限（``followup_sweep.MAX_TRACKS_PER_BUCKET``）一致。
MAX_DECISIONS_PER_CARD = 5


class FollowupDecisionIn(BaseModel):
    """一家岗位的决策：contacted / replied / stopped。"""

    model_config = ConfigDict(extra="forbid")

    track_id: int = Field(ge=1)
    decision: str = Field(min_length=1, max_length=16)

    @field_validator("decision")
    @classmethod
    def decision_must_be_known(cls, value: str) -> str:
        if value not in FOLLOWUP_DECISIONS:
            raise ValueError(f"未知的跟进决策：{value}")
        return value


class FollowupDecisionsRequest(BaseModel):
    """整卡一次提交（卡片 id + 1..5 条决策）。

    ``track_id`` 去重：同一家岗位在一张卡里只该有一条 step，重复出现说明前端把
    同一行提交了两次——直接 422，而不是在服务层猜"以哪条为准"。
    """

    model_config = ConfigDict(extra="forbid")

    task_id: int = Field(ge=1)
    decisions: list[FollowupDecisionIn] = Field(min_length=1, max_length=MAX_DECISIONS_PER_CARD)

    @field_validator("decisions")
    @classmethod
    def track_ids_must_be_unique(cls, value: list[FollowupDecisionIn]) -> list[FollowupDecisionIn]:
        seen: set[int] = set()
        duplicated: list[int] = []
        for item in value:
            if item.track_id in seen:
                duplicated.append(item.track_id)
            seen.add(item.track_id)
        if duplicated:
            names = "、".join(str(track_id) for track_id in duplicated)
            raise ValueError(f"同一岗位不能重复决策：{names}")
        return value


class FollowupDecisionStepOut(BaseModel):
    """响应里回显的步骤快照（前端据此原地更新卡片，不重新拉全量列表）。"""

    model_config = ConfigDict(from_attributes=True)

    step_index: int
    kind: str
    title: str
    status: str
    output_ref: dict[str, Any] | None = None


class FollowupDecisionsOut(BaseModel):
    """整卡提交结果。

    - ``decided``：本次提交的决策条数（请求里的条数）；
    - ``created_rows``：真正新落的 application_follow_up 行数；已处理过的 step
      不重复落行，所以重放时它会是 0；
    - ``idempotent``：本次提交是否全部命中了已处理状态（= created_rows 为 0）。
    """

    task_id: int
    status: str
    decided: int
    created_rows: int
    idempotent: bool
    steps: list[FollowupDecisionStepOut] = Field(default_factory=list)


class SubmitConfirmationOut(BaseModel):
    """「我已提交」的写侧回执（契约 B 节）。

    ``created_track`` / ``created_reminder`` 用来让前端说清"这次真的新建了什么"；
    连点重放时两者都是 false，行数不变。``show_followup_hint`` 是一次性引导：
    只在开关开着、且从未展示过时为 true（同事务落"已展示"）。
    """

    record_id: int
    track_id: int
    reminder_id: int
    reminder_due_at: datetime
    created_track: bool
    created_reminder: bool
    show_followup_hint: bool


__all__ = [
    "MAX_DECISIONS_PER_CARD",
    "FollowupDecisionIn",
    "FollowupDecisionStepOut",
    "FollowupDecisionsOut",
    "FollowupDecisionsRequest",
    "SubmitConfirmationOut",
]
