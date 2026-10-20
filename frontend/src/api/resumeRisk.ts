// SPDX-License-Identifier: Apache-2.0
/** 简历风险扫描接口。 */
import type { ResumeRiskScan } from "../types/resumeRisk";
import { request } from "./client";

/**
 * 扫描一份简历的风险点。
 *
 * ``enhance=false`` 时只跑本地规则：不把遮罩后的简历发给你配置的模型（RR-01）。
 * 默认 true 与历史行为一致（配置了模型就增强）。
 *
 * 预算是借用的 ``recognition``（90s）：这条接口**非流式、要等完整 JSON**，而
 * ``default`` 的 15s 在模型增强叠加长简历时不够用；超时由后端自己先降级（45s 硬上限），
 * 真正等满 90s 只会出现在后端完全没响应时。
 *
 * ``signal`` 由模块级 store 传入：用户点「取消」或重新发起扫描时 abort 旧请求。
 */
export function scanResumeRisks(
  id: number,
  enhance = true,
  signal?: AbortSignal,
): Promise<ResumeRiskScan> {
  return request(`/resumes/${id}/risk-scan`, {
    method: "POST",
    body: JSON.stringify({ enhance }),
    budget: "recognition",
    signal,
  });
}
