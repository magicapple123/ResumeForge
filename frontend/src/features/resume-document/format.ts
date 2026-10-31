// SPDX-License-Identifier: Apache-2.0
/**
 * item 值的展示格式化（纯函数，编辑器 chips / 预览标签共用）。
 *
 * 规范值 + format 的存法（D7）：日期范围存 `start|end`、列表存字符串数组、作者存结构化
 * 数组；**只在展示时**拼成用户看到的字符串。切换语言不迁移数据。
 */
import type { ItemFormat, ResumeAuthor, ResumeItem } from "../../types/resumeDocument";
import type { Locale } from "../../i18n";

/** 日期范围在规范值里的分隔符（与后端 planner 同一约定）。 */
export const DATE_RANGE_SEPARATOR = "|";

export function splitDateRange(value: string): { start: string; end: string } {
  const [start = "", end = ""] = value.split(DATE_RANGE_SEPARATOR);
  return { start: start.trim(), end: end.trim() };
}

export function joinDateRange(start: string, end: string): string {
  const left = start.trim();
  const right = end.trim();
  if (!left && !right) return "";
  return `${left}${DATE_RANGE_SEPARATOR}${right}`;
}

export interface DateRangeFormatOptions {
  locale?: Locale;
  /** "至今"的文案；缺省按语言给 `至今` / `Present`。 */
  presentLabel?: string;
  /** 起止之间的连接符；缺省按语言给 ` – ` / ` – `。 */
  separator?: string;
}

/** 把 `start|end` 格式化成 `2020-09 – 2024-06`；end 为空时用"至今"。 */
export function formatDateRange(value: string, options: DateRangeFormatOptions = {}): string {
  const { start, end } = splitDateRange(value);
  const present = options.presentLabel ?? "";
  const separator = options.separator ?? " – ";
  if (!start && !end) return "";
  if (!end) return present ? `${start || present}${separator}${present}` : start;
  if (!start) return present ? `${present}${separator}${end}` : end;
  return `${start}${separator}${end}`;
}

const LIST_JOIN_SEPARATORS: Record<string, { "zh-CN": string; "en-US": string }> = {
  comma: { "zh-CN": "\uFF0C", "en-US": ", " },
  semicolon: { "zh-CN": "\uFF1B", "en-US": "; " },
  dot: { "zh-CN": " \u00B7 ", "en-US": " \u00B7 " },
  inline: { "zh-CN": " ", "en-US": " " },
};

/** 按 join 规则拼接列表值；空值/空数组返回空串。 */
export function formatListValues(
  values: readonly string[],
  join: string = "semicolon",
  locale: Locale = "zh-CN",
): string {
  const kept = values.map((value) => value.trim()).filter((value) => value !== "");
  const separator = (LIST_JOIN_SEPARATORS[join] ?? LIST_JOIN_SEPARATORS.semicolon)[locale];
  return kept.join(separator);
}

/** 作者列表：只展示姓名（本人加粗 / 通讯星号由渲染器处理，不写进文本）。 */
export function formatAuthors(authors: readonly ResumeAuthor[], locale: Locale = "zh-CN"): string {
  const names = authors.map((author) => author.name.trim()).filter((name) => name !== "");
  return names.join(locale === "en-US" ? ", " : "\u3001");
}

export interface ItemValueFormatOptions {
  locale?: Locale;
  presentLabel?: string;
  /** 枚举显示名解析（目录 / 语言包提供）；缺省显示规范值。 */
  resolveEnum?: (value: string) => string;
}

/** 单个 field 值的展示文本（编辑器 chips、标签行预览用）。 */
export function formatFieldValue(
  value: string,
  format: ItemFormat,
  options: ItemValueFormatOptions = {},
): string {
  switch (format) {
    case "date_range":
      return formatDateRange(value, options);
    case "list":
      return formatListValues(value.split(DATE_RANGE_SEPARATOR), "semicolon", options.locale);
    case "enum":
      return options.resolveEnum ? options.resolveEnum(value) : value;
    default:
      return value;
  }
}

/** 任意 item 的展示文本（不改变数据，只给 UI 一个单行预览）。 */
export function itemDisplayValue(item: ResumeItem, options: ItemValueFormatOptions = {}): string {
  switch (item.kind) {
    case "field":
      return formatFieldValue(item.value, item.format, options);
    case "list":
      return formatListValues(item.values, item.join, options.locale);
    case "authors":
      return formatAuthors(item.authors, options.locale);
    case "text":
      return item.text;
    default:
      return "";
  }
}

/** 字段目录标签 → 兜底：item.label（用户覆盖）> 目录标签 > key。 */
export function itemDisplayLabel(item: ResumeItem, catalogLabel = ""): string {
  if (item.kind === "text") return "";
  return item.label || catalogLabel || item.key;
}
