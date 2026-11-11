// SPDX-License-Identifier: Apache-2.0
/**
 * 今日简报接口（18B，后端 app/api/assistant_breadth.py）。
 *
 * 只读展示：简报是界面卡片，不进模型上下文。数字（参考分）在这里展示并强制带免责文案，
 * 助手工具侧仍遵守"不把数字评分喂给模型"的红线。
 */
import { request } from "../../../api/client";

/** 简报条目的形状按板块不同（同一个扁平结构，缺字段即该板块不适用）。 */
export interface DigestItem {
  job_id?: number | null;
  record_id?: number;
  track_id?: number;
  title?: string;
  company?: string;
  /** 14B 参考分（0–100）；只有 worth_jobs 有。 */
  score?: number;
  /** 无回音天数；只有 stale_applications 有。 */
  days?: number;
  /** 距面试还有几天；只有 interviews 有。 */
  days_until?: number;
  next_action?: string;
  next_action_date?: string;
}

export interface DigestFunnelSummary {
  applied: number;
  succeeded: number;
  failed: number;
  interviewing: number;
}

export interface DigestSection {
  key: "worth_jobs" | "stale_applications" | "interviews" | "expired_jobs" | "funnel" | string;
  count: number;
  items?: DigestItem[];
  link?: string;
  note?: string;
  disclaimer?: string;
  today_count?: number;
  summary?: DigestFunnelSummary;
  window_days?: number;
  horizon_days?: number;
}

export interface AssistantDigest {
  generated_at: string;
  sections: DigestSection[];
  changes: { count: number; jd_changed: number; stale: number };
  refresh_hours: number;
}

const TASK_BUDGET = "task" as const;

/** 启动/打开助手页时取简报：后端自己判断要不要补算（24h / 跨过设置时刻）。 */
export function getAssistantDigest(): Promise<AssistantDigest> {
  return request<AssistantDigest>("/assistant/digest", { budget: TASK_BUDGET });
}

/** 卡片上的「重新生成」：无条件重算。 */
export function refreshAssistantDigest(): Promise<AssistantDigest> {
  return request<AssistantDigest>("/assistant/digest/refresh", {
    method: "POST",
    budget: TASK_BUDGET,
  });
}
