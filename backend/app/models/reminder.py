# SPDX-License-Identifier: Apache-2.0
"""日历提醒：把"什么时候该做什么"从人脑里搬到本地日程。

提醒不自己发明时机，只记录用户或流程**明确给出**的时点（面试时间、测评截止、该催 HR 回复了）。
它同时绑定三个可选对象——求职进度（``application_track``）、岗位（``job``）、简历版本
（``resume_record``），但三者都可空：一条"周日整理简历"的提醒不绑定任何漏斗，一条
"跟进某岗位"的提醒只绑岗位。绑定用 ``SET NULL``：被绑对象删除后提醒仍保留，只是失去关联。

设计要点（CR-28 起）：

- **两层状态**：``Reminder.status``（active/archived）只回答"这个计划还继续吗"；
  每一次到期是 ``ReminderOccurrence`` 的一行（pending/done/skipped），回答"这一次处理了吗"。
  单次完成不再把整条提醒判死——``none`` 规则下完成即归档，``weekly`` 等规则下生成下一次。
- **``Reminder.remind_at`` 是投影**：它恒等于"当前待办那一次"的 ``due_at``，由
  ``services/reminder_occurrences`` 单独维护（唯一写入者）。历史与推迟来源在 occurrence 表里，
  读列表/首页时不必 join 也能排序，代价是这条投影必须跟着 occurrence 一起改。
- **``kind`` 四类**（interview/assessment_deadline/hr_reply/other）：决定提醒在界面上怎么
  归类展示，不决定提醒内容本身。
- **``recurrence`` + ``recurrence_until``**：none/daily/weekly/monthly；until 为空表示一直重复。
  done 与 skipped 都会生成下一次（跳过不等于取消计划）。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, event, insert
from sqlalchemy.orm import Mapped, Mapper, mapped_column

from app.vocabulary.reminder import (
    REMINDER_KIND_ASSESSMENT_DEADLINE,
    REMINDER_KIND_HR_REPLY,
    REMINDER_KIND_INTERVIEW,
    REMINDER_KIND_OTHER,
    REMINDER_KINDS,
    REMINDER_OCCURRENCE_STATUS_DONE,
    REMINDER_OCCURRENCE_STATUS_PENDING,
    REMINDER_OCCURRENCE_STATUS_SKIPPED,
    REMINDER_OCCURRENCE_STATUSES,
    REMINDER_RECURRENCE_DAILY,
    REMINDER_RECURRENCE_MONTHLY,
    REMINDER_RECURRENCE_NONE,
    REMINDER_RECURRENCE_WEEKLY,
    REMINDER_RECURRENCES,
    REMINDER_STATUS_ACTIVE,
    REMINDER_STATUS_ARCHIVED,
    REMINDER_STATUS_DISMISSED,
    REMINDER_STATUS_DONE,
    REMINDER_STATUS_PENDING,
    REMINDER_STATUSES,
)

from ..database import Base
from .profile import utcnow

# 提醒种类与状态词表已下沉到 ``app/vocabulary/reminder.py``（D8：契约层不再经由 models
# 取词表）。这里逐个显式 re-export，既有 ``from app.models.reminder import ...`` 不变。
# 旧二态常量（pending/done/dismissed）保留为输入别名，见 vocabulary 模块注释。


class Reminder(Base):
    """一条日历提醒（= 一个计划）。"""

    __tablename__ = "reminder"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    # 下一次待办到期的时刻（naive UTC）。它是 occurrence 的投影，不是独立真相：
    # 创建时 = 第一次 due_at；完成/推迟时由 occurrence 服务同步改写。列表按它升序排
    # "接下来要做什么"，避免为排序 join 一次 occurrence。
    remind_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    kind: Mapped[str] = mapped_column(String(32), default=REMINDER_KIND_OTHER)
    status: Mapped[str] = mapped_column(String(16), default=REMINDER_STATUS_ACTIVE, index=True)
    # 重复规则与结束条件；none = 单次。until 为空表示一直重复。
    recurrence: Mapped[str] = mapped_column(
        String(16), default=REMINDER_RECURRENCE_NONE, index=False
    )
    recurrence_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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
    # CR-22 的投递标记。CR-28 起**不再写入**：投递幂等改由 ``ReminderOccurrence.notified_at``
    # 承担（每次到期各有自己的标记）。列先保留，避免为一次语义迁移做一次丢数据的列删除。
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # 软删除时间戳：NULL 表示「没删」。列表查询一律复用 ``services/trash.live_only``。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ReminderOccurrence(Base):
    """一次到期（计划的某一次实例）。

    ``due_at`` 是这次该提醒的时刻；``snoozed_from`` 记录被推迟前的原始时刻（第一次推迟时
    写入，之后再次推迟保持最早的那个），用来回答"这次本来是什么时候"。
    ``notified_at`` 是投递幂等标记：只有把它从 NULL 条件更新成功的那一轮才发通知。
    """

    __tablename__ = "reminder_occurrence"

    id: Mapped[int] = mapped_column(primary_key=True)
    reminder_id: Mapped[int] = mapped_column(
        ForeignKey("reminder.id", ondelete="CASCADE"), nullable=False, index=True
    )
    due_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(
        String(16), default=REMINDER_OCCURRENCE_STATUS_PENDING, index=True
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    snoozed_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


@event.listens_for(Reminder, "after_insert")
def _create_first_occurrence(
    mapper: Mapper, connection, target: Reminder  # noqa: ARG001 - SQLAlchemy 事件签名固定
) -> None:
    """任何路径新建提醒，都落一条 pending occurrence（CR-28 的不变量）。

    为什么不只在 service 里生成：提醒也会被助手工具、巡检、测试夹具直接构造。若只在
    ``create_reminder`` 里补，别处建出来的提醒会"活着但没有待办"——列表看不到、不会
    提醒、也不会建卡，而这种缺失只会在很久以后表现为"提醒不响"。

    用 ``connection.execute`` 而不是 session.add：此时主键已生成，且在同一个 flush 事务里，
    后续查询立刻能看到这一行。
    """
    moment = target.created_at or utcnow()
    # 用 ``insert(Model)`` 而不是 ``Model.__table__.insert()``：后者在 pyright 眼里
    # 只是 ``FromClause``（没有 insert 属性），CI 的静态检查会红。
    connection.execute(
        insert(ReminderOccurrence).values(
            reminder_id=target.id,
            due_at=target.remind_at,
            status=REMINDER_OCCURRENCE_STATUS_PENDING,
            notified_at=None,
            snoozed_from=None,
            created_at=moment,
            updated_at=moment,
        )
    )


__all__ = [
    "REMINDER_KINDS",
    "REMINDER_KIND_ASSESSMENT_DEADLINE",
    "REMINDER_KIND_HR_REPLY",
    "REMINDER_KIND_INTERVIEW",
    "REMINDER_KIND_OTHER",
    "REMINDER_OCCURRENCE_STATUSES",
    "REMINDER_OCCURRENCE_STATUS_DONE",
    "REMINDER_OCCURRENCE_STATUS_PENDING",
    "REMINDER_OCCURRENCE_STATUS_SKIPPED",
    "REMINDER_RECURRENCES",
    "REMINDER_RECURRENCE_DAILY",
    "REMINDER_RECURRENCE_MONTHLY",
    "REMINDER_RECURRENCE_NONE",
    "REMINDER_RECURRENCE_WEEKLY",
    "REMINDER_STATUSES",
    "REMINDER_STATUS_ACTIVE",
    "REMINDER_STATUS_ARCHIVED",
    "REMINDER_STATUS_DISMISSED",
    "REMINDER_STATUS_DONE",
    "REMINDER_STATUS_PENDING",
    "Reminder",
    "ReminderOccurrence",
]
