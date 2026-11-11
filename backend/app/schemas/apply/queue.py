# SPDX-License-Identifier: Apache-2.0
"""投递队列 schema。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from ..job_match import AdmissionResult, HardGateResult
from .base import (
    GREETING_INPUT_MAX_CHARS,
    MAX_QUEUE_BATCH,
    MAX_TASK_TARGETS,
    QueueStatus,
)

# ===== 投递队列 =====


class ApplyQueueAddItem(BaseModel):
    """加入队列的一项：岗位必填，简历与招呼语可选。"""

    model_config = ConfigDict(extra="forbid")

    job_id: int = Field(ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    greeting: str = Field(default="", max_length=GREETING_INPUT_MAX_CHARS)
    # 命中"真实缺口"时，用户需要显式确认为真才会入队。
    confirm_real_gap: bool = False
    # 尚未分析过的岗位，用户需要显式确认"我知道它没分析过"。
    confirm_unanalyzed: bool = False


class ApplyQueueAddRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ApplyQueueAddItem] = Field(min_length=1, max_length=MAX_QUEUE_BATCH)


class ApplyQueueItemUpdate(BaseModel):
    """PATCH 语义：只更新提交了的字段（None = 不改）。"""

    model_config = ConfigDict(extra="forbid")

    greeting: str | None = Field(default=None, max_length=GREETING_INPUT_MAX_CHARS)
    resume_id: int | None = Field(default=None, ge=1)


class ApplyQueueReorderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order: list[int] = Field(default_factory=list, max_length=MAX_TASK_TARGETS)


class ApplyQueueItemOut(BaseModel):
    """队列条目，附带该岗位最近一次匹配结论的摘要，供界面展示准入。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    resume_id: int | None = None
    resume_title: str = ""
    greeting: str = ""
    sort_order: int = 0
    status: QueueStatus = "pending"
    # 最近一次匹配结论摘要：未分析时 admission / hard_gate 为 None。
    admission: AdmissionResult | None = None
    hard_gate: HardGateResult | None = None
    requires_confirm: bool = False
    # 这个岗位能不能自动投递：取决于**来源**是否落在已注册招聘网站上，与匹配结论无关。
    # 默认 True 是刻意的兜底方向——万一某处没算，结果是"界面允许、后端拒绝并说明原因"，
    # 而不是把能投的岗位误标成不能投。
    apply_supported: bool = True
    # 14B：参考分（0-100，派生值、不参与准入）。未分析或读不出可用结论时为 None——
    # 用 None 而不是 0，界面才能把"没算过"和"算了但很低"分开显示。
    match_score: int | None = None
    # 14B：岗位广场里的收藏标记，界面据此提供「只看收藏」筛选。
    favorite: bool = False
    # 15A：僵尸分（0–100，派生值、不参与准入）。``None`` = **历史不足**（采样 < 2 条），
    # 界面显示「历史不足」而不是 0 分——0 分意味着"看过很多次、看不出问题"，把两者混成
    # 一个数会让新采集的岗位看起来"很健康"，那正是这个功能要反对的说法。
    ghost_score: int | None = None
    ghost_evidence: list[str] = Field(default_factory=list)
    # 15A：用户已忽略这条岗位的僵尸提示。界面上"僵尸 75"徽标与「忽略」按钮的状态都读它；
    # 它**不影响** ghost_score（分数照旧下发）——忽略只是不再提醒，不是分数被清零。
    ghost_ignored: bool = False
    # 15B：重采时 JD 指纹变过。**被动式**——只有下次采集才会更新，UI 必须写明这点。
    jd_changed: bool = False
    created_at: datetime
    updated_at: datetime


class ApplyQueueListOut(BaseModel):
    """队列列表（P2-2）：上限内的一页 + 全量口径的 total。

    ``truncated`` 为真时界面必须如实提示"已显示前 N 条"，不悄悄截断。
    """

    items: list[ApplyQueueItemOut] = Field(default_factory=list)
    total: int
    truncated: bool = False
