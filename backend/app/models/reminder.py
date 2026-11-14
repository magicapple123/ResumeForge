# SPDX-License-Identifier: Apache-2.0
"""日历提醒：把"什么时候该做什么"从人脑里搬到本地日程。

提醒不自己发明时机，只记录用户或流程**明确给出**的时点（面试时间、测评截止、该催 HR 回复了）。
它同时绑定三个可选对象——求职进度（``application_track``）、岗位（``job``）、简历版本
（``resume_record``），但三者都可空：一条"周日整理简历"的提醒不绑定任何漏斗，一条
"跟进某岗位"的提醒只绑岗位。绑定用 ``SET NULL``：被绑对象删除后提醒仍保留，只是失去关联。

设计要点：

- **``kind`` 四类**（interview/assessment_deadline/hr_reply/other）：决定提醒在界面上怎么
  归类展示，不决定提醒内容本身。
- **``status`` 三态**（pending/done/dismissed）：只回答"待办 / 已完成 / 已忽略"，不含
  复杂的调度状态机——调度留给 P3 的服务层，表里只存结果。
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.vocabulary.reminder import (
    REMINDER_KIND_ASSESSMENT_DEADLINE,
    REMINDER_KIND_HR_REPLY,
    REMINDER_KIND_INTERVIEW,
    REMINDER_KIND_OTHER,
    REMINDER_KINDS,
    REMINDER_STATUS_DISMISSED,
    REMINDER_STATUS_DONE,
    REMINDER_STATUS_PENDING,
    REMINDER_STATUSES,
)

from ..database import Base
from .profile import utcnow

# 提醒种类与状态词表已下沉到 ``app/vocabulary/reminder.py``（D8：契约层不再经由 models
# 取词表）。这里逐个显式 re-export，既有 ``from app.models.reminder import ...`` 不变。


class Reminder(Base):
    """一条日历提醒。"""

    __tablename__ = "reminder"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    # 提醒时间：提醒的唯一权威时点，列表按它升序排"接下来要做什么"。
    remind_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    kind: Mapped[str] = mapped_column(String(32), default=REMINDER_KIND_OTHER)
    status: Mapped[str] = mapped_column(String(16), default=REMINDER_STATUS_PENDING, index=True)
    # 三个可选绑定对象，均为 SET NULL：被绑对象删除后提醒仍保留。
    track_id: Mapped[int | None] = mapped_column(
        ForeignKey("application_track.id", ondelete="SET NULL"), nullable=True, index=True
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # 软删除时间戳：NULL 表示「没删」。列表查询一律复用 ``services/trash.live_only``。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = [
    "REMINDER_KINDS",
    "REMINDER_KIND_ASSESSMENT_DEADLINE",
    "REMINDER_KIND_HR_REPLY",
    "REMINDER_KIND_INTERVIEW",
    "REMINDER_KIND_OTHER",
    "REMINDER_STATUSES",
    "REMINDER_STATUS_DISMISSED",
    "REMINDER_STATUS_DONE",
    "REMINDER_STATUS_PENDING",
    "Reminder",
]
