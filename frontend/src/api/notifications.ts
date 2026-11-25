// SPDX-License-Identifier: Apache-2.0
/**
 * 通知中心（inbox）接口。
 *
 * 读侧四个端点与后端 `api/notifications.py` 一一对应；写侧只有一个受限的 `ingest`：
 * 任务的终态由**执行它的那一侧**最先知道（批次与 AI 任务在前端轮询到终态时后端线程
 * 早已结束），所以完成提醒在客户端上报，服务端只收「任务类」通知，见后端类型白名单。
 */
import { buildQuery, request } from "./client";

/** 一条 inbox 通知（与后端 `NotificationOut` 同形）。 */
export interface AppNotification {
  id: number;
  type: string;
  severity: string;
  title: string;
  body: string;
  deep_link: string;
  read_at: string | null;
  created_at: string;
  expires_at: string | null;
}

/** 客户端可上报的通知类型（与后端 `CLIENT_REPORTABLE_TYPES` 对齐）。 */
export type ClientNotificationType = "background_task" | "agent_task";

export interface NotificationIngestPayload {
  type: ClientNotificationType;
  severity?: "info" | "warning";
  title: string;
  body?: string;
  deep_link?: string;
  dedupe_key: string;
}

export function listNotifications(
  params: { limit?: number; before?: string } = {},
): Promise<AppNotification[]> {
  return request(`/notifications${buildQuery(params)}`);
}

export function unreadNotificationCount(): Promise<{ unread: number }> {
  return request("/notifications/unread-count");
}

export function markNotificationRead(id: number): Promise<AppNotification> {
  return request(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return request("/notifications/read-all", { method: "POST" });
}

export function recordNotification(payload: NotificationIngestPayload): Promise<AppNotification> {
  return request("/notifications/ingest", { method: "POST", body: JSON.stringify(payload) });
}
