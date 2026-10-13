/** 简历风险扫描接口。 */
import type { ResumeRiskScan } from "../types/resumeRisk";
import { request } from "./client";

/**
 * 扫描一份简历的风险点。
 *
 * ``enhance=false`` 时只跑本地规则：不把遮罩后的简历发给你配置的模型（RR-01）。
 * 默认 true 与历史行为一致（配置了模型就增强）。
 */
export function scanResumeRisks(id: number, enhance = true): Promise<ResumeRiskScan> {
  return request(`/resumes/${id}/risk-scan`, {
    method: "POST",
    body: JSON.stringify({ enhance }),
  });
}
