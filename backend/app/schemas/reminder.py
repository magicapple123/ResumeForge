# SPDX-License-Identifier: Apache-2.0
"""日历提醒（R-12）的请求/响应结构。

提醒把"什么时候该做什么"落成一条记录：标题是提醒内容，``remind_at`` 是唯一权威时点，
``kind`` 决定归类，``status`` 三态只回答"待办 / 已完成 / 已忽略"。三个绑定对象
（``track_id``/``job_id``/``resume_id``）都可空，被删对象置空（外键 SET NULL）。

写入侧严格校验（标题非空、时点必填、kind/status 白名单）；读取侧如实回显。
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..vocabulary.reminder import (
    REMINDER_KIND_OTHER,
    REMINDER_KINDS,
    REMINDER_LEGACY_STATUSES,
    REMINDER_RECURRENCE_NONE,
    REMINDER_RECURRENCES,
    REMINDER_STATUS_ACTIVE,
    REMINDER_STATUSES,
)

MAX_REMINDER_TITLE_CHARS = 200
MAX_REMINDER_NOTE_CHARS = 4000

ReminderKind = Literal["interview", "assessment_deadline", "hr_reply", "other"]
#: 计划状态（DB 列 ``reminder.status``）：这条提醒还要不要继续。
ReminderStatus = Literal["active", "archived"]
#: 写入侧的状态动作：新取值 + 旧二态别名（done/dismissed 落到 open occurrence，见 CR-28）。
ReminderStatusAction = Literal["active", "archived", "pending", "done", "dismissed"]
ReminderRecurrence = Literal["none", "daily", "weekly", "monthly"]
ReminderSnoozePreset = Literal["one_hour", "tonight", "tomorrow_morning"]
ReminderUrgency = Literal["overdue", "soon", "upcoming", "later"]


def _validate_kind(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned not in REMINDER_KINDS:
        raise ValueError(f"无效的提醒类型，可选值：{'、'.join(REMINDER_KINDS)}")
    return cleaned


def _validate_status(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned not in REMINDER_STATUSES:
        raise ValueError(f"无效的提醒状态，可选值：{'、'.join(REMINDER_STATUSES)}")
    return cleaned


def _validate_recurrence(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned not in REMINDER_RECURRENCES:
        raise ValueError(f"无效的重复规则，可选值：{'、'.join(REMINDER_RECURRENCES)}")
    return cleaned


class ReminderCreate(BaseModel):
    """新增一条提醒。标题与提醒时间是必填，其余都有默认值。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=MAX_REMINDER_TITLE_CHARS)
    remind_at: datetime
    kind: ReminderKind = REMINDER_KIND_OTHER
    status: ReminderStatus = REMINDER_STATUS_ACTIVE
    #: none|daily|weekly|monthly；until 为空表示一直重复。
    recurrence: ReminderRecurrence = REMINDER_RECURRENCE_NONE
    recurrence_until: datetime | None = None
    track_id: int | None = Field(default=None, ge=1)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    note: str = Field(default="", max_length=MAX_REMINDER_NOTE_CHARS)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("提醒标题不能为空")
        return cleaned

    @field_validator("kind")
    @classmethod
    def kind_must_be_supported(cls, value: str) -> str:
        return _validate_kind(value)

    @field_validator("status")
    @classmethod
    def status_must_be_supported(cls, value: str) -> str:
        return _validate_status(value)

    @field_validator("recurrence")
    @classmethod
    def recurrence_must_be_supported(cls, value: str) -> str:
        return _validate_recurrence(value)


class ReminderUpdate(BaseModel):
    """PATCH 语义：只更新显式给出的字段，未给出的保持不变。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=MAX_REMINDER_TITLE_CHARS)
    remind_at: datetime | None = None
    kind: ReminderKind | None = None
    #: 新取值（active/archived）改计划状态；旧二态（done/dismissed/pending）改"这一次"，
    #: 落在 open occurrence 上。两者都保留是因为助手与旧前端仍在用二态说法（CR-28）。
    status: ReminderStatusAction | None = None
    recurrence: ReminderRecurrence | None = None
    recurrence_until: datetime | None = None
    track_id: int | None = Field(default=None, ge=1)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    note: str | None = Field(default=None, max_length=MAX_REMINDER_NOTE_CHARS)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("提醒标题不能为空")
        return cleaned

    @field_validator("kind")
    @classmethod
    def kind_must_be_supported(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_kind(value)

    @field_validator("status")
    @classmethod
    def status_must_be_supported(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        # 旧二态别名是**输入动作**（见 vocabulary 注释），不写回 reminder.status。
        if cleaned not in (*REMINDER_STATUSES, *REMINDER_LEGACY_STATUSES):
            raise ValueError(
                "无效的提醒状态，可选值："
                + "、".join((*REMINDER_STATUSES, *REMINDER_LEGACY_STATUSES))
            )
        return cleaned

    @field_validator("recurrence")
    @classmethod
    def recurrence_must_be_supported(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_recurrence(value)


class ReminderSnoozeIn(BaseModel):
    """稍后提醒：给预设或绝对时刻（二选一）。

    预设按本机时区解析（今晚 20:00 / 明早 9:00）；``until`` 走与新建相同的归一口径。
    """

    model_config = ConfigDict(extra="forbid")

    preset: ReminderSnoozePreset | None = None
    until: datetime | None = None

    @model_validator(mode="after")
    def exactly_one_target(self) -> "ReminderSnoozeIn":
        if (self.preset is None) == (self.until is None):
            raise ValueError("请给 preset（稍后预设）或 until（自定义时刻）之一")
        return self


class ReminderOut(ReminderCreate):
    """读取回显：在写入结构之外补上服务端生成字段。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ReminderUpcomingOut(ReminderOut):
    """待办提醒的首页回显：在 ReminderOut 之外补紧急度、结构化倒计时与展示标签。

    ``urgency`` / ``days_until`` / ``due_label`` 不在表里，由 ``services/reminder_service``
    统一计算。
    """

    urgency: ReminderUrgency = "later"
    # 结构化倒计时（负数=逾期天数，0=今天，1=明天，N=N 天后）；前端按界面语言自行组合文案。
    days_until: int = 0
    # 后端拼好的中文标签：保留给旧前端/其它调用方，新界面用 days_until。
    due_label: str = ""


class ReminderListItemOut(ReminderOut):
    """提醒列表的单条回显：在 ReminderOut 之外补紧急度与结构化倒计时（**只给列表用**）。

    列表是"接下来要做什么"的全集，逾期项也需要在列表里一眼看出（首页「近期提醒」卡
    已有同样口径，两处必须一致）。写操作（创建 / PATCH）仍回显 ``ReminderOut``：它们
    不需要这两个派生字段，回显口径不跟着列表走。

    两个字段**必填**（无默认值）：列表路由必须显式经过 ``reminder_list_items_out`` 计算，
    漏接时会直接序列化失败，而不是悄悄下发 ``later / 0`` 这种假值。
    """

    urgency: ReminderUrgency
    days_until: int


__all__ = [
    "MAX_REMINDER_NOTE_CHARS",
    "MAX_REMINDER_TITLE_CHARS",
    "ReminderCreate",
    "ReminderKind",
    "ReminderListItemOut",
    "ReminderOut",
    "ReminderSnoozeIn",
    "ReminderSnoozePreset",
    "ReminderStatus",
    "ReminderStatusAction",
    "ReminderUpcomingOut",
    "ReminderUpdate",
    "ReminderUrgency",
]
