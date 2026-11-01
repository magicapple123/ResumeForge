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

/**
 * 已知能力键 → 词条。未知键仍会显示（原始机器码是 ASCII，可接受）。
 *
 * 覆盖后端 `CAPABILITY_KEYS` 全量 13 项（#5d 起 italic 已移除）：少一项就会在界面上
 * 漏出 `manual_page_break` 这类机器码（2026-10-29 试用对比里可见），而这份字典是
 * **唯一**的翻译点。
 */
export const CAPABILITY_LABEL_KEY: Record<string, MessageKey> = {
  link_clickable: "preflight.capability.linkClickable",
  page_numbers: "preflight.capability.pageNumbers",
  missing_glyph: "preflight.capability.missingGlyph",
  bold: "preflight.capability.bold",
  columns: "preflight.capability.columns",
  text_order: "preflight.capability.textOrder",
  tables: "preflight.capability.tables",
  section_breaks: "preflight.capability.sectionBreaks",
  custom_font: "preflight.capability.customFont",
  section_order: "preflight.capability.sectionOrder",
  hidden_entries: "preflight.capability.hiddenEntries",
  manual_page_break: "preflight.capability.manualPageBreak",
  keep_with_next: "preflight.capability.keepWithNext",
  entry_spacing: "preflight.capability.entrySpacing",
  body_color: "preflight.capability.bodyColor",
  scholar_skills_grid: "preflight.capability.scholarSkillsGrid",
  research_fields: "preflight.capability.researchFields",
  long_cv: "preflight.capability.longCv",
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

/**
 * 原因码 → 词条（R-26）。码由后端 `capability_notes` 下发，**文案在这里**：
 * 后端写中文会让英文界面漏出中文（英文名为证：R-26 验收要看英文界面）。
 *
 * 未收录的码不显示提示（而不是显示裸码）——这样后端加新码时界面退化成"没有 Tooltip"，
 * 而不是把 `plain_text_no_style` 这种内部字符串怼到用户脸上。
 */
export const NOTE_MESSAGE_KEY: Record<string, MessageKey> = {
  browser_print: "preflight.capability.note.browser_print",
  browser_no_page_number: "preflight.capability.note.browser_no_page_number",
  no_italic_glyph: "preflight.capability.note.no_italic_glyph",
  link_text_only: "preflight.capability.note.link_text_only",
  font_substitute: "preflight.capability.note.font_substitute",
  table_approx: "preflight.capability.note.table_approx",
  plain_text_no_style: "preflight.capability.note.plain_text_no_style",
  plain_text_no_pagination: "preflight.capability.note.plain_text_no_pagination",
  plain_text_no_layout: "preflight.capability.note.plain_text_no_layout",
  plain_text_only: "preflight.capability.note.plain_text_only",
  data_only: "preflight.capability.note.data_only",
};

/** `{format: {capability: code}}`（后端形状）→ 扁平查找表。坏数据一律忽略。 */
export function parseCapabilityNotes(
  raw: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const notes: Record<string, string> = {};
  if (!raw) return notes;
  for (const [format, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    for (const [capability, code] of Object.entries(value as Record<string, unknown>)) {
      if (typeof code === "string" && code.trim()) notes[`${format}:${capability}`] = code;
    }
  }
  return notes;
}
