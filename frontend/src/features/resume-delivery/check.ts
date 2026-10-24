// SPDX-License-Identifier: Apache-2.0
/**
 * 导出前核对（W19 / D20，契约 §6.5）：目标岗位、文件名、联系方式、选择的版本、文档模式、
 * 隐藏条目数——六项都在**同一份快照**上取值。
 *
 * 这里只做纯计算（前端可离线先算一份；真实判定最终由 W11 preflight 的 `export_summary`
 * 返回，两者形状相同）。"版本变了吗"的判据是发起预览/核对时的 expectedRevision 与服务端
 * 当前 revision 不一致；**不**用时间戳比较（跨窗口不可靠）。
 */
import type { ResumeContent } from "../../types/resume";
import { ENTRY_POINT_FIELDS } from "../resume-document/types";
import type { ExportCheckSummary } from "./types";

export interface ExportCheckInput {
  resumeTitle: string;
  /** 关联岗位（没有岗位时为空串，不编造）。 */
  company: string;
  jobTitle: string;
  content: ResumeContent | null | undefined;
  /** 服务端当前 revision。 */
  revision: number;
  /** 发起核对时看到的 revision；null/缺省 = 不做版本比对。 */
  expectedRevision?: number | null;
  /** 文档模式（普通简历 / 长 CV）；缺省 resume。 */
  documentMode?: string;
}

/** 统计六类条目里被隐藏的数量（隐藏条目仍留在编辑内容里，正式导出会排除）。 */
export function countHiddenEntries(content: ResumeContent | null | undefined): number {
  if (!content) return 0;
  let count = 0;
  for (const field of Object.keys(ENTRY_POINT_FIELDS)) {
    const entries = (content as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object" && (entry as { hidden?: boolean }).hidden === true)
        count += 1;
    }
  }
  return count;
}

/** 联系人是否至少有一条可用联系方式（电话或邮箱）。 */
export function hasContact(content: ResumeContent | null | undefined): boolean {
  if (!content) return false;
  return Boolean(content.phone.trim() || content.email.trim());
}

/** 组装 D20 摘���（与后端 `export_summary` 同形）。 */
export function buildExportCheckSummary(input: ExportCheckInput): ExportCheckSummary {
  const revisionChanged =
    input.expectedRevision !== undefined &&
    input.expectedRevision !== null &&
    input.expectedRevision !== input.revision;
  return {
    target_company: input.company.trim(),
    target_job_title: input.jobTitle.trim(),
    resume_title: input.resumeTitle.trim(),
    contact_present: hasContact(input.content),
    document_mode: input.documentMode ?? "resume",
    revision: input.revision,
    revision_changed: revisionChanged,
    hidden_count: countHiddenEntries(input.content),
  };
}

/**
 * 核对卡是否必须**阻断**导出：只有"版本已变"需要用户显式确认（避免按旧版本导出）；
 * 联系方式缺失、目标岗位为空是"提醒"而不是硬失败（用户可能就是要导出通用版）。
 */
export function exportBlockedByRevision(summary: ExportCheckSummary): boolean {
  return summary.revision_changed;
}

/** 缺失项清单（UI 逐条给"补什么"；不把审美/个人信息当硬失败）。 */
export type ExportCheckWarning =
  "no-target" | "no-contact" | "has-hidden" | "revision-changed" | "long-cv";

export function collectExportWarnings(summary: ExportCheckSummary): ExportCheckWarning[] {
  const warnings: ExportCheckWarning[] = [];
  if (!summary.target_company && !summary.target_job_title) warnings.push("no-target");
  if (!summary.contact_present) warnings.push("no-contact");
  if (summary.hidden_count > 0) warnings.push("has-hidden");
  if (summary.revision_changed) warnings.push("revision-changed");
  if (summary.document_mode === "long_cv") warnings.push("long-cv");
  return warnings;
}
