// SPDX-License-Identifier: Apache-2.0
/**
 * 导出前核对（W19 / D20，契约 §6.5）：目标岗位、文件名、联系方式、选择的版本、文档模式、
 * 隐藏条目数——六项都在同一份快照上取值。
 *
 * 这里只做纯计算（前端可离线先算一份；真实判定最终由 W11 preflight 的 export_summary
 * 返回，两者形状相同）。"版本变了吗"的判据是发起预览/核对时的 expectedRevision 与服务端
 * 当前 revision 不一致；不用时间戳比较（跨窗口不可靠）。
 *
 * v2 文档模型下联系方式在 header.items、隐藏条目在 entry.hidden 与 item.placement，
 * 这里按 version 分支读取；v1 形状保留只因为旧测试/旧导出的离线快照还在用。
 */
import type { ResumeContent } from "../../types/resume";
import type { ResumeDocument } from "../../types/resumeDocument";
import { ENTRY_POINT_FIELDS } from "../resume-document/types";
import type { ExportCheckSummary } from "./types";

type ContentLike = ResumeContent | ResumeDocument | null | undefined;

function isV2Document(content: ContentLike): content is ResumeDocument {
  return Boolean(
    content &&
    (content as ResumeDocument).version === 2 &&
    Array.isArray((content as ResumeDocument).sections),
  );
}

export interface ExportCheckInput {
  resumeTitle: string;
  company: string;
  jobTitle: string;
  content: ContentLike;
  revision: number;
  expectedRevision?: number | null;
  documentMode?: string;
}

/** 统计被隐藏的条目与字段（隐藏后仍留在编辑内容里，正式导出会排除）。 */
export function countHiddenEntries(content: ContentLike): number {
  if (!content) return 0;
  if (isV2Document(content)) {
    let count = 0;
    for (const section of content.sections) {
      for (const entry of section.entries) {
        if (entry.hidden) count += 1;
        for (const item of entry.items) {
          if (item.kind === "text") {
            if (item.hidden) count += 1;
          } else if (item.placement === "hidden") {
            count += 1;
          }
        }
      }
    }
    return count;
  }
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
export function hasContact(content: ContentLike): boolean {
  if (!content) return false;
  if (isV2Document(content)) {
    return content.header.items.some(
      (item) =>
        item.placement === "contact" &&
        (item.key === "phone" || item.key === "email") &&
        item.value.trim().length > 0,
    );
  }
  return Boolean(content.phone.trim() || content.email.trim());
}

/** 组装 D20 摘要（与后端 export_summary 同形）。 */
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

/** 只有"版本已变"需要用户显式确认；联系方式缺失、目标岗位为空是提醒而不是硬失败。 */
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
