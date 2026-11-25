// SPDX-License-Identifier: Apache-2.0
/** 日历提醒接口。 */
import type { Reminder, ReminderPayload, ReminderSnoozePayload, ReminderUpcoming } from "../types";
import { buildQuery, request } from "./client";

export function listReminders(
  params: { kind?: string; status?: string; limit?: number } = {},
): Promise<Reminder[]> {
  return request(`/reminders${buildQuery(params)}`);
}

export function listUpcomingReminders(limit = 50): Promise<ReminderUpcoming[]> {
  return request(`/reminders/upcoming?limit=${limit}`);
}

export function createReminder(payload: ReminderPayload): Promise<Reminder> {
  return request("/reminders", { method: "POST", body: JSON.stringify(payload) });
}

export function updateReminder(id: number, payload: Partial<ReminderPayload>): Promise<Reminder> {
  return request(`/reminders/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

/**
 * 稍后提醒（CR-28）：只推移"这一次"的到期时刻，不新建提醒。
 *
 * 预设按**本机时区**解释（今晚 20:00 / 明早 9:00 说的是用户自己的钟点），所以在后端算，
 * 前端不自己换算——两端口径只留一份。
 */
export function snoozeReminder(id: number, payload: ReminderSnoozePayload): Promise<Reminder> {
  return request(`/reminders/${id}/snooze`, { method: "POST", body: JSON.stringify(payload) });
}

export function deleteReminder(id: number): Promise<void> {
  return request(`/reminders/${id}`, { method: "DELETE" });
}
