// SPDX-License-Identifier: Apache-2.0
/**
 * 扫描件识别接口（`/api/ocr/*`）。
 *
 * 为什么是"任务 + 轮询"而不是一次请求等结果：OCR 服务端上限 180 秒，而前端识别档预算
 * 只有 90 秒（Q20）——同步等必然被前端先掐断，用户看到"失败"但钱已经花了。改成任务后，
 * 创建请求只负责上传（`upload` 预算），进度靠轮询（`default` 预算）。
 *
 * **没有取消接口**：服务端断开不会中止识别，照常计费、并发名额也不释放。前端只能
 * "停止等待"（不再轮询），按钮文案必须如实说明。
 */
import { request, uploadWithProgress } from "./client";

export type OcrEngine = "auto" | "ocr" | "vision";

export interface OcrEngineOption {
  value: OcrEngine;
  /** 后端给的可读说明（前端不再写一份中文，否则两边迟早说两套）。 */
  label: string;
}

export interface OcrSettings {
  engine: OcrEngine;
  key_configured: boolean;
  engine_options: OcrEngineOption[];
}

export interface OcrTaskCreated {
  task_id: string;
  total_pages: number;
}

export type OcrTaskState = "running" | "succeeded" | "failed";

export interface OcrTaskStatus {
  task_id: string;
  status: OcrTaskState;
  total_pages: number;
  pages_done: number;
  elapsed_ms: number;
  text: string;
  warnings: string[];
  error_code: string;
  error_detail: string;
  /** 恒为 false：服务端不会因为前端离开而停止识别。 */
  server_cancel_supported: boolean;
}

export function getOcrSettings(): Promise<OcrSettings> {
  return request("/ocr/settings");
}

export function saveOcrSettings(engine: OcrEngine): Promise<OcrSettings> {
  return request("/ocr/settings", { method: "PUT", body: JSON.stringify({ engine }) });
}

/**
 * 创建识别任务。`onProgress` 是**上传字节**进度（0–100），不是识别进度；
 * 识别进度看 `getOcrTask` 返回的 `pages_done / total_pages`。
 */
export function createOcrTask(
  file: File,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<OcrTaskCreated> {
  const form = new FormData();
  form.append("file", file, file.name);
  return uploadWithProgress<OcrTaskCreated>("/ocr/tasks", form, {
    budget: "upload",
    onProgress: options.onProgress,
    signal: options.signal,
  });
}

export function getOcrTask(taskId: string): Promise<OcrTaskStatus> {
  return request(`/ocr/tasks/${encodeURIComponent(taskId)}`);
}
