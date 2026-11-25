// SPDX-License-Identifier: Apache-2.0
/** 通知偏好接口（CR-29）：六个开关与静默时段。 */
import { request } from "./client";

export interface NotificationSettings {
  notify_reminder_due: boolean;
  notify_task_waiting: boolean;
  notify_task_done: boolean;
  notify_batch_done: boolean;
  notify_sound: boolean;
  notify_quiet_hours: boolean;
  quiet_start: string;
  quiet_end: string;
  quiet_active: boolean;
}

/** 部分更新：只传要改的键，未传的保持原值。 */
export type NotificationSettingsPatch = Partial<
  Pick<
    NotificationSettings,
    | "notify_reminder_due"
    | "notify_task_waiting"
    | "notify_task_done"
    | "notify_batch_done"
    | "notify_sound"
    | "notify_quiet_hours"
  >
>;

export function getNotificationSettings(): Promise<NotificationSettings> {
  return request("/settings/notifications");
}

export function saveNotificationSettings(
  patch: NotificationSettingsPatch,
): Promise<NotificationSettings> {
  return request("/settings/notifications", { method: "PUT", body: JSON.stringify(patch) });
}
