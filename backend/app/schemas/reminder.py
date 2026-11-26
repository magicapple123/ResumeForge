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

#: 内外简历互斥的统一文案（R14）。schema 层的 422 与 service 层"合并后状态"的 422 必须
#: 说同一句话——用户不该因为"两个都给了"和"改完变成两个"看到两种不同的解释。
REMINDER_RESUME_LINK_CONFLICT = (
    "一条提醒只能关联一份简历：内部简历与外部简历二选一，请取消其中一个"
)

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
    #: 外部简历（R14）：用户在别处生成的原件。与 ``resume_id`` **互斥**——一条提醒这次
    #: 要跟进的只能是"一份"简历，两个都填会让读侧（提醒卡 / 通知落点 / 助手）必须解释
    #: "以谁为准"，而那个答案永远不合理。
    external_resume_id: int | None = Field(default=None, ge=1)
    note: str = Field(default="", max_length=MAX_REMINDER_NOTE_CHARS)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("提醒标题不能为空")
        return cleaned

    @model_validator(mode="after")
    def resume_links_are_exclusive(self) -> "ReminderCreate":
        """内外简历不能同时关联（R14，沿用 ``application_track`` 的先例）。

        为什么是 422 而不是"后一个覆盖前一个"：两个字段同时非空只可能来自调用方把两次
        选择叠在同一个 payload 里（前端漏清另一侧，或助手工具直接拼参数）。静默挑一个
        会出现"界面显示 A、库里存 B"，而这条关联的全部用途就是回答"这次跟进哪一份"。
        """
        if self.resume_id is not None and self.external_resume_id is not None:
            raise ValueError(REMINDER_RESUME_LINK_CONFLICT)
        return self

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
    #: 外部简历（R14）：与 ``resume_id`` 互斥，见 :meth:`resume_links_are_exclusive`。
    external_resume_id: int | None = Field(default=None, ge=1)
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

    @model_validator(mode="after")
    def resume_links_are_exclusive(self) -> "ReminderUpdate":
        """PATCH 语义下只能校验**本次请求**，合并后的最终状态由 service 兜住。

        为什么分两层：

        - 这里只看"这次请求里两个字段都显式给了非空值"——这是调用方把两次选择叠在一起
          的唯一特征，schema 能独立判定，不必读库。
        - "合并后变成两个都有"（例如只给 ``external_resume_id``，而库里还存着
          ``resume_id``）只有 service 拿得到旧行，见
          ``reminder_service._assert_single_resume_link``。

        反过来，"把 ``resume_id`` 置空 + 同时给 ``external_resume_id``"是**合法**的一次
        改选：合并后只剩一份，不该被这里拦下。
        """
        if (
            "resume_id" in self.model_fields_set
            and "external_resume_id" in self.model_fields_set
            and self.resume_id is not None
            and self.external_resume_id is not None
        ):
            raise ValueError(REMINDER_RESUME_LINK_CONFLICT)
        return self

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
    #: 外部简历标题（R14）：口径与 tracker 的外部简历标题一致——``external_resume.name``，
    #: **实时读**（提醒没有标题快照列）。服务层把它挂到 ORM 实例上再序列化，见
    #: ``reminder_service._attach_external_resume_names``；没关联外部简历时是空串。
    external_resume_name: str = ""


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
    "REMINDER_RESUME_LINK_CONFLICT",
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
