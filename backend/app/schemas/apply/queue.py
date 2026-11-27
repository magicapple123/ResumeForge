# SPDX-License-Identifier: Apache-2.0
"""投递队列 schema。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..job_match import AdmissionResult, HardGateResult
from .base import (
    GREETING_INPUT_MAX_CHARS,
    MAX_GREETING_IMAGES,
    MAX_QUEUE_BATCH,
    MAX_TASK_TARGETS,
    QueueStatus,
    check_resume_link_exclusive,
)

# ===== 投递队列 =====


class ApplyQueueAddItem(BaseModel):
    """加入队列的一项：岗位必填，简历与招呼语可选。"""

    model_config = ConfigDict(extra="forbid")

    job_id: int = Field(ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    #: 用**外部简历原件**投递（T30）：与 ``resume_id`` 互斥，同时给 → 422。
    external_resume_id: int | None = Field(default=None, ge=1)
    greeting: str = Field(default="", max_length=GREETING_INPUT_MAX_CHARS)
    # 命中"真实缺口"时，用户需要显式确认为真才会入队。
    confirm_real_gap: bool = False
    # 尚未分析过的岗位，用户需要显式确认"我知道它没分析过"。
    confirm_unanalyzed: bool = False

    @model_validator(mode="after")
    def resume_links_are_exclusive(self) -> "ApplyQueueAddItem":
        """内外简历二选一（T30）：判定只有 ``check_resume_link_exclusive`` 一处实现。"""
        check_resume_link_exclusive(self.resume_id, self.external_resume_id)
        return self


class ApplyQueueAddRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ApplyQueueAddItem] = Field(min_length=1, max_length=MAX_QUEUE_BATCH)


class ApplyQueueItemUpdate(BaseModel):
    """PATCH 语义：只更新提交了的字段（None = 不改）。"""

    model_config = ConfigDict(extra="forbid")

    greeting: str | None = Field(default=None, max_length=GREETING_INPUT_MAX_CHARS)
    resume_id: int | None = Field(default=None, ge=1)
    #: 改用**外部简历原件**投递（T30）；显式给 null = 改回"按默认规则找简历"。
    external_resume_id: int | None = Field(default=None, ge=1)
    # 行内覆盖招呼语配图（T8）：给空列表 = 明确"这条不发图"（不会退回全局默认），
    # 给 None/不传 = 不改。与 ``greeting`` 的语义不同，这是刻意为之——「清空」是用户能
    # 表达的一个具体意愿，而"没提交这个字段"只是没提到它。
    image_ids: list[int] | None = Field(default=None, max_length=MAX_GREETING_IMAGES)

    @model_validator(mode="after")
    def resume_links_are_exclusive(self) -> "ApplyQueueItemUpdate":
        """PATCH 语义下只看**本次请求**：两个键都显式给了非空值才算"叠了两次选择"。

        合并后的最终状态由 service 兜住（``update_queue_item`` 里改选一侧就清另一侧），
        因为 schema 看不到库里已存的那一侧——与 R14 提醒的分层完全一致。
        """
        if (
            "resume_id" in self.model_fields_set
            and "external_resume_id" in self.model_fields_set
        ):
            check_resume_link_exclusive(self.resume_id, self.external_resume_id)
        return self


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
    #: 这条岗位改用**外部简历原件**投递时指向那一份（T30）；与 ``resume_id`` 互斥。
    #: 非空时 ``resume_title`` 是那份外部简历的名字，界面据此渲染「外部 · xxx.pdf」。
    external_resume_id: int | None = None
    resume_title: str = ""
    greeting: str = ""
    # 招呼语配图（T8）：``user_file.id`` 列表，**不含 data URL**（一张截图 base64 就是
    # MB 级，队列页会被撑爆）。空列表 = 这条没单独选图，运行时退回全局默认。
    image_ids: list[int] = Field(default_factory=list)
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
