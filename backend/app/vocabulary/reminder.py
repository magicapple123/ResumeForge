# SPDX-License-Identifier: Apache-2.0
"""日历提醒的词表：提醒种类、计划状态、单次到期状态与重复规则。

CR-28 起**两层状态**，回答两个不同的问题：

- ``Reminder.status``（active / archived）= **这个计划还要不要继续**。用户停用/归档整条提醒
  才变 archived；单次完成不会让计划消失（否则每周复盘做完一次就再也提醒不了）。
- ``ReminderOccurrence.status``（pending / done / skipped）= **这一次到期处理得怎么样**。
  done / skipped 只结束这一次，并按 ``recurrence`` 生成下一次。

旧取值 ``pending / done / dismissed`` 已迁移到上面两层（迁移 0028），这里保留三个常量仅作
**输入别名**：PATCH / 助手工具仍接受「标完成 = done」「不用管 = dismissed」，服务层把它们
翻译成 occurrence 的终态，不会写回 ``Reminder.status``。
"""

# ===== 提醒种类（前后端共用一份取值）=====
REMINDER_KIND_INTERVIEW = "interview"
REMINDER_KIND_ASSESSMENT_DEADLINE = "assessment_deadline"
REMINDER_KIND_HR_REPLY = "hr_reply"
REMINDER_KIND_OTHER = "other"
REMINDER_KINDS = (
    REMINDER_KIND_INTERVIEW,
    REMINDER_KIND_ASSESSMENT_DEADLINE,
    REMINDER_KIND_HR_REPLY,
    REMINDER_KIND_OTHER,
)

# ===== 计划状态（Reminder.status）：启用 / 已归档 =====
REMINDER_STATUS_ACTIVE = "active"
REMINDER_STATUS_ARCHIVED = "archived"
REMINDER_STATUSES = (
    REMINDER_STATUS_ACTIVE,
    REMINDER_STATUS_ARCHIVED,
)

# ===== 单次到期状态（ReminderOccurrence.status）=====
REMINDER_OCCURRENCE_STATUS_PENDING = "pending"
REMINDER_OCCURRENCE_STATUS_DONE = "done"
REMINDER_OCCURRENCE_STATUS_SKIPPED = "skipped"
REMINDER_OCCURRENCE_STATUSES = (
    REMINDER_OCCURRENCE_STATUS_PENDING,
    REMINDER_OCCURRENCE_STATUS_DONE,
    REMINDER_OCCURRENCE_STATUS_SKIPPED,
)

# ===== 输入别名（旧二态写法；只用于入参翻译，不落库）=====
REMINDER_STATUS_PENDING = "pending"
REMINDER_STATUS_DONE = "done"
REMINDER_STATUS_DISMISSED = "dismissed"
REMINDER_LEGACY_STATUSES = (
    REMINDER_STATUS_PENDING,
    REMINDER_STATUS_DONE,
    REMINDER_STATUS_DISMISSED,
)

# ===== 重复规则 =====
REMINDER_RECURRENCE_NONE = "none"
REMINDER_RECURRENCE_DAILY = "daily"
REMINDER_RECURRENCE_WEEKLY = "weekly"
REMINDER_RECURRENCE_MONTHLY = "monthly"
REMINDER_RECURRENCES = (
    REMINDER_RECURRENCE_NONE,
    REMINDER_RECURRENCE_DAILY,
    REMINDER_RECURRENCE_WEEKLY,
    REMINDER_RECURRENCE_MONTHLY,
)

# ===== 稍后提醒预设（服务层解析成绝对时刻）=====
REMINDER_SNOOZE_ONE_HOUR = "one_hour"
REMINDER_SNOOZE_TONIGHT = "tonight"
REMINDER_SNOOZE_TOMORROW_MORNING = "tomorrow_morning"
REMINDER_SNOOZE_PRESETS = (
    REMINDER_SNOOZE_ONE_HOUR,
    REMINDER_SNOOZE_TONIGHT,
    REMINDER_SNOOZE_TOMORROW_MORNING,
)
#: 「今晚」与「明早」的钟点（本机时区）。
REMINDER_TONIGHT_HOUR = 20
REMINDER_TOMORROW_HOUR = 9
