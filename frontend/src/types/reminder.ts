// SPDX-License-Identifier: Apache-2.0
/** 日历提醒（后端 /api/reminders）。 */

export const REMINDER_KINDS = ["interview", "assessment_deadline", "hr_reply", "other"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * 计划状态（CR-28）：这条提醒还要不要继续。每一次到期是否处理过由后端的
 * `reminder_occurrence` 决定，不再挤在这一列里。
 */
export const REMINDER_STATUSES = ["active", "archived"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/**
 * 写入侧的状态**动作**：`done` / `dismissed` 是旧二态别名，落到"当前这一次"
 * （done→已完成、dismissed→跳过）；`active` / `archived` 改计划本身。
 */
export const REMINDER_STATUS_ACTIONS = [
  "active",
  "archived",
  "pending",
  "done",
  "dismissed",
] as const;
export type ReminderStatusAction = (typeof REMINDER_STATUS_ACTIONS)[number];

/** 重复规则（CR-28）：none = 单次。 */
export const REMINDER_RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export type ReminderRecurrence = (typeof REMINDER_RECURRENCES)[number];

/** 稍后提醒预设；`custom` 走绝对时刻（`until`），后端只认前三个。 */
export const REMINDER_SNOOZE_PRESETS = ["one_hour", "tonight", "tomorrow_morning"] as const;
export type ReminderSnoozePreset = (typeof REMINDER_SNOOZE_PRESETS)[number];

/** 首页紧急度（与后端 services/reminder_service 唯一实现处保持一致）。 */
export const REMINDER_URGENCIES = ["overdue", "soon", "upcoming", "later"] as const;
export type ReminderUrgency = (typeof REMINDER_URGENCIES)[number];

export const REMINDER_URGENCY_COLORS: Record<ReminderUrgency, string> = {
  overdue: "red",
  soon: "orange",
  upcoming: "blue",
  later: "default",
};

export interface Reminder {
  id: number;
  title: string;
  /** 提醒时间（ISO 字符串），列表按它升序排"接下来要做什么"。 */
  remind_at: string;
  kind: string;
  status: string;
  /** 重复规则与结束条件（CR-28）；旧后端没有这两列时按单次/一直重复处理。 */
  recurrence?: ReminderRecurrence;
  recurrence_until?: string | null;
  track_id: number | null;
  job_id: number | null;
  resume_id: number | null;
  /**
   * 外部简历关联（R14）：与 `resume_id` **互斥**（后端同时传两个会 422）。
   * 旧后端没有这个字段，按缺省 `null` 处理。
   */
  external_resume_id?: number | null;
  /**
   * 外部简历的标题回显（R14）：口径是 `external_resume.name`，由后端在详情 / 列表 /
   * upcoming 上实时拼好。只有关联了外部简历时才有值，未关联是空串。
   */
  external_resume_name?: string;
  note: string;
  created_at: string;
  updated_at: string;
  /**
   * 列表接口额外下发的紧急度与结构化倒计时（后端 `reminder_service` 计算）。
   * 可选：写操作回显（创建 / PATCH）仍是 ReminderOut，不带这两个字段；旧后端也没有。
   * 前端**不重算**天数——「已逾期 N 天」的 N 直接取 `days_until` 的负值。
   */
  urgency?: ReminderUrgency;
  days_until?: number;
}

/** 首页待办提醒：在 Reminder 之外补紧急度与展示标签（由后端 /upcoming 计算）。 */
export interface ReminderUpcoming extends Reminder {
  urgency: ReminderUrgency;
  /**
   * 结构化倒计时：负数=逾期天数，0=今天，1=明天，N=N 天后。
   * 可选——旧后端没有这个字段，此时界面回退到 `due_label`。
   */
  days_until?: number;
  /** 后端拼好的中文标签，仅作旧后端/旧数据的回退（界面文案由前端按语言组合）。 */
  due_label: string;
}

export interface ReminderPayload {
  title: string;
  remind_at: string;
  kind?: ReminderKind;
  status?: ReminderStatusAction;
  recurrence?: ReminderRecurrence;
  recurrence_until?: string | null;
  track_id?: number | null;
  job_id?: number | null;
  resume_id?: number | null;
  /** 外部简历关联（R14）：与 `resume_id` 互斥，写请求里两个都要显式给出（见 resumeRef.ts）。 */
  external_resume_id?: number | null;
  note?: string;
}

/** 稍后提醒：预设与绝对时刻二选一（后端会校验）。 */
export interface ReminderSnoozePayload {
  preset?: ReminderSnoozePreset;
  until?: string;
}
