// SPDX-License-Identifier: Apache-2.0
/** 统一检查接口（W11）。端点由 W11-BE 落地；这里只做请求体/响应类型与调用。 */
import { request } from "../../api/client";
import type { PreflightOut, PreflightRequest } from "./types";

/**
 * `POST /api/resumes/{id}/preflight`。
 *
 * 预算用 `task`（30s）：产物层要真渲染一次 PDF（契约 §4.9 Q1 约 400ms 量级），
 * 而默认 15s 在慢机器 + 大文件时不够；它也不该占 `export` 的 10 分钟预算。
 */
export function runPreflight(
  resumeId: number,
  body: PreflightRequest,
  signal?: AbortSignal,
): Promise<PreflightOut> {
  return request(`/resumes/${resumeId}/preflight`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
    budget: "task",
  });
}
