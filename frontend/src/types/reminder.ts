// SPDX-License-Identifier: Apache-2.0
/** 日历提醒（后端 /api/reminders）。 */

export const REMINDER_KINDS = ["interview", "assessment_deadline", "hr_reply", "other"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_STATUSES = ["pending", "done", "dismissed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

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
  track_id: number | null;
  job_id: number | null;
  resume_id: number | null;
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
  status?: ReminderStatus;
  track_id?: number | null;
  job_id?: number | null;
  resume_id?: number | null;
  note?: string;
}
