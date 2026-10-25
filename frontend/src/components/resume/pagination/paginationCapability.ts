// SPDX-License-Identifier: Apache-2.0
/** 分页面板的能力矩阵短句（纯函数，从 `paginationParts.tsx` 拆出以免 fast-refresh 警告）。 */
import { t, type MessageKey } from "../../../i18n";
import {
  FORMAT_LABEL_KEY,
  LEVEL_LABEL_KEY,
  parseCapabilities,
} from "../../../features/resume-preflight/capabilities";

/** 与分页最相关的矩阵能力键。 */
const CAPABILITY_KEYS = ["manual_page_break", "keep_with_next", "page_numbers"] as const;
const CAPABILITY_LABEL: Record<string, MessageKey> = {
  manual_page_break: "pagination.capability.entryBreak",
  keep_with_next: "pagination.capability.keepWithNext",
  page_numbers: "pagination.capability.pageNumbers",
};
const FORMATS = ["html", "pdf", "docx"] as const;

/** 能力矩阵 → "PDF 手动分页 不支持"这种短句（只列非 supported）。 */
export function capabilityLines(capabilities: Record<string, string>): string[] {
  const matrix = parseCapabilities(capabilities);
  const lines: string[] = [];
  for (const capability of CAPABILITY_KEYS) {
    const cell = matrix.rows.find((row) => row.capability === capability);
    if (!cell) continue;
    const labelKey = CAPABILITY_LABEL[capability];
    const name = labelKey ? t(labelKey) : capability;
    for (const format of FORMATS) {
      const level = cell.levels[format] ?? "unknown";
      if (level === "supported") continue;
      const formatKey = FORMAT_LABEL_KEY[format];
      const formatLabel = formatKey ? t(formatKey) : format;
      lines.push(`${formatLabel} ${name} ${t(LEVEL_LABEL_KEY[level])}`);
    }
  }
  return lines;
}
