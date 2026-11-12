// SPDX-License-Identifier: Apache-2.0
/**
 * 「从链接导入」的接口封装（#16C / #17A）。
 *
 * 单独一个文件而不是塞进 api/jobs.ts：这条链路的口径（预览行带四态与原文依据、
 * 补详情分批可中断、合并模式）与 CSV 导入不是同一种数据形状，混进同一模块会让两边
 * 的类型都变模糊。
 */
import { request } from "../../api/client";

export type FieldState = "filled" | "not_on_page" | "not_fetched" | "fetch_failed";
export type FetchEngine = "auto" | "http" | "browser";
/** #16 分页停止原因（后端 fetcher.STOP_REASONS 同值）。 */
export type FromUrlStopReason = "no_next" | "limit" | "http_error" | "rejected";

export interface FromUrlRow {
  data: Record<string, string>;
  detail_url: string;
  summary: string;
  evidence: Record<string, string>;
  field_states: Record<string, FieldState>;
  detail_error: string;
  posted_at_raw: string;
  posted_at_inferred: boolean;
  job_type_inferred: boolean;
  jd_split: boolean;
  existing_job_id: number | null;
}

export interface FromUrlPreview {
  url: string;
  engine: string;
  method: string;
  fetched_on: string;
  total: number;
  rows: FromUrlRow[];
  warnings: string[];
  // #16 分页（收尾任务 2）：抓了几页、是否还有/是否中途失败、为什么停。
  pages_requested: number;
  pages_fetched: number;
  truncated: boolean;
  stop_reason: FromUrlStopReason;
}

export interface FromUrlDetailsResult {
  rows: FromUrlRow[];
  warnings: string[];
}

export interface FromUrlCommitResult {
  imported: number;
  updated: number;
  skipped: { index: number; title: string; message: string }[];
  failed: { index: number; title: string; message: string }[];
}

export interface PreviewPayload {
  url: string;
  engine: FetchEngine;
  limit: number;
  intent: "job_list" | "job_detail";
  /** #16 分页：1–10 页；只跟随页面声明的「下一页」，不猜 URL 模板。 */
  pages: number;
}

/** 抓列表页并返回预览行（不落库）。浏览器引擎最多等 20s，模型抽取再占一些，给 90s 预算。 */
export function previewFromUrl(
  payload: PreviewPayload,
  signal?: AbortSignal,
): Promise<FromUrlPreview> {
  return request<FromUrlPreview>("/jobs/import/from-url/preview", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "recognition",
    signal,
  });
}

/** 补详情（每批 ≤5 条；前端分批调用实现进度与中断）。 */
export function fetchRowDetails(
  rows: FromUrlRow[],
  engine: FetchEngine,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<FromUrlDetailsResult> {
  return request<FromUrlDetailsResult>("/jobs/import/from-url/details", {
    method: "POST",
    body: JSON.stringify({ rows, engine, page_url: pageUrl }),
    budget: "recognition",
    signal,
  });
}

/** 确认导入：新建 / 仅补空字段 / 跳过已在库的行。 */
export function commitFromUrl(
  rows: FromUrlRow[],
  fillEmptyOnly: boolean,
): Promise<FromUrlCommitResult> {
  return request<FromUrlCommitResult>("/jobs/import/from-url/commit", {
    method: "POST",
    body: JSON.stringify({ rows, fill_empty_only: fillEmptyOnly }),
    budget: "task",
  });
}
