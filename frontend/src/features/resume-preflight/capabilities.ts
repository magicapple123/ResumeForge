// SPDX-License-Identifier: Apache-2.0
/**
 * 格式能力矩阵的**消费**（W11 与 W05 的接口，契约 §4.5）。
 *
 * 唯一来源是后端 `format_capabilities.py` 下发的 `capabilities`；前端**不再写第二份判定表**，
 * 只做三件事：解析键（`format:capability` / `format.capability` 两种都认）、把已知能力键
 * 翻成本地词条、未知键原样显示（不编造解释）。
 */
import type { MessageKey } from "../../i18n";

export type CapabilityLevel = "supported" | "approx" | "unsupported" | "unknown";

/** 已知能力键 → 词条。未知键仍会显示（原始机器码是 ASCII，可接受）。 */
export const CAPABILITY_LABEL_KEY: Record<string, MessageKey> = {
  italic: "preflight.capability.italic",
  link_clickable: "preflight.capability.linkClickable",
  page_numbers: "preflight.capability.pageNumbers",
  missing_glyph: "preflight.capability.missingGlyph",
  bold: "preflight.capability.bold",
  columns: "preflight.capability.columns",
  text_order: "preflight.capability.textOrder",
  tables: "preflight.capability.tables",
  section_breaks: "preflight.capability.sectionBreaks",
};

/** 格式键 → 展示名；未知格式原样显示。 */
export const FORMAT_LABEL_KEY: Record<string, MessageKey> = {
  html: "preflight.format.html",
  pdf: "preflight.format.pdf",
  pdf_download: "preflight.format.pdfDownload",
  docx: "preflight.format.docx",
  markdown: "preflight.format.markdown",
  md: "preflight.format.markdown",
  txt: "preflight.format.txt",
  json: "preflight.format.json",
};

export interface CapabilityCell {
  capability: string;
  /** 已知能力的词条键；未知能力为 undefined（UI 原样显示机器码）。 */
  labelKey?: MessageKey;
  /** format → 等级。 */
  levels: Record<string, CapabilityLevel>;
}

export interface CapabilityMatrix {
  formats: string[];
  rows: CapabilityCell[];
}

function normalizeLevel(value: string): CapabilityLevel {
  return value === "supported" || value === "approx" || value === "unsupported" ? value : "unknown";
}

/** 拆键：兼容 `pdf:italic` 与 `pdf.italic`。 */
function splitKey(key: string): { format: string; capability: string } | null {
  const separator = key.includes(":") ? ":" : ".";
  const index = key.indexOf(separator);
  if (index <= 0) return null;
  return {
    format: key.slice(0, index),
    capability: key.slice(index + 1),
  };
}

/**
 * 解析后端能力字典 → 矩阵。
 *
 * 同时接受两种形状：扁平 `{"pdf:italic": "approx"}` 与嵌套 `{"pdf": {"italic": "approx"}}`
 * （契约 4.5 的 CAPABILITIES 是嵌套结构，4.2 响应字段写的是 dict[str,str]；两种都兼容，
 * 等 W11-BE 落地后只保留实际那一种）。
 */
export function parseCapabilities(
  raw: Record<string, unknown> | null | undefined,
): CapabilityMatrix {
  const formats: string[] = [];
  const rows = new Map<string, CapabilityCell>();
  const push = (format: string, capability: string, level: CapabilityLevel) => {
    if (!formats.includes(format)) formats.push(format);
    const labelKey = CAPABILITY_LABEL_KEY[capability];
    const existing = rows.get(capability);
    if (existing) existing.levels[format] = level;
    else rows.set(capability, { capability, labelKey, levels: { [format]: level } });
  };
  if (!raw) return { formats, rows: [] };
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === "object") {
      for (const [capability, level] of Object.entries(value as Record<string, unknown>)) {
        push(key, capability, normalizeLevel(String(level)));
      }
      continue;
    }
    const pair = splitKey(key);
    if (pair) push(pair.format, pair.capability, normalizeLevel(String(value)));
  }
  return { formats, rows: [...rows.values()] };
}

/** 能力等级 → 词条（supported / approx / unsupported / unknown）。 */
export const LEVEL_LABEL_KEY: Record<CapabilityLevel, MessageKey> = {
  supported: "preflight.capability.supported",
  approx: "preflight.capability.approx",
  unsupported: "preflight.capability.unsupported",
  unknown: "preflight.capability.unknown",
};
