// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料填入」：把一条资料（v1 字段形状）转换成 v2 items（纯函数）。
 *
 * ## 规则
 *
 * - 字段落到目录的**默认位置**（短字段 trail / 长文本 body / 标题 title）——与新建简历投影
 *   完全同一套映射，避免"投影写一处、填入写另一处"；
 * - 每个 item 带 `source = {section_key, field_id}`，供溯源 / AI 补值 / 去重；
 * - 长文本数组（description / highlights / achievements / outcomes）**一行一个正文块**，
 *   字符串则成一段；`end_date` 为空时保留"至今"语义（value 里 end 为空）；
 * - 自建板块：主文本 → 正文段落，`lines` 每行 → trail 字段（label 存在 item 上）；
 * - 只做加法：`mergeProfileItems` 只填空值，不覆盖用户已经写下的内容。
 */
import type {
  AuthorsItem,
  FieldSource,
  ItemFormat,
  ResumeItem,
  TextItem,
} from "../../types/resumeDocument";
import { defaultAuthorsItem, defaultFieldItem, defaultListItem, defaultTextItem } from "./defaults";
import { FALLBACK_SECTIONS, type FallbackFieldSpec } from "./fieldCatalog";
import { joinDateRange } from "./format";
import { newObjectId } from "./identity";

export interface ProfileFillInput {
  /** 简历文档里的板块 key（education / custom:<id> …）。 */
  sectionKey: string;
  /** 资料条目的字段值（v1 形状即可）。 */
  values: Record<string, unknown>;
  /** 资料来源分区键（educations / projects …），写进 item.source.section_key。 */
  profileSectionKey?: string;
  /** 自建板块的主文本（v1 `ResumeCustomEntry.text`）。 */
  text?: string;
  /** 自建板块的标签行（v1 `lines`），可选带资料字段 id / key。 */
  lines?: { label: string; value: string; field_id?: string | number; key?: string }[];
}

export interface ConvertedItems {
  items: ResumeItem[];
  warnings: string[];
}

const DATE_END_KEYS = new Set(["end_date"]);

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim() !== "") {
    return value
      .split(/\r?\n|\u3001|\uFF0C|,/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return [];
}

function sourceOf(
  profileSectionKey: string | undefined,
  fieldId: string | number | undefined,
): FieldSource | null {
  if (!profileSectionKey || fieldId === undefined) return null;
  return { section_key: profileSectionKey, field_id: String(fieldId) };
}

function periodValue(values: Record<string, unknown>): string {
  const start = asText(values.start_date);
  const end = asText(values.end_date);
  return start || end ? joinDateRange(start, end) : "";
}

function authorsOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((author) => {
    if (author === null || typeof author !== "object") return [];
    const record = author as Record<string, unknown>;
    return [
      {
        name: asText(record.name),
        is_self: record.is_self === true,
        corresponding: record.corresponding === true,
      },
    ];
  });
}

/** 长文本字段里"一行一块"的正文（数组逐行成要点，字符串成一段）。 */
function textItemsOf(value: unknown): TextItem[] {
  const lines = Array.isArray(value) ? asTextList(value) : [];
  if (lines.length > 0) {
    return lines
      .filter((line) => line.trim() !== "")
      .map((line) => defaultTextItem(line, "bullet"));
  }
  const text = asText(value);
  return text.trim() === "" ? [] : [defaultTextItem(text, "paragraph")];
}

const LONG_TEXT_KEYS = new Set([
  "description",
  "highlights",
  "achievements",
  "outcomes",
  "content",
]);

function buildItem(
  sectionKey: string,
  profileSectionKey: string | undefined,
  spec: FallbackFieldSpec,
  values: Record<string, unknown>,
  warnings: string[],
): ResumeItem[] {
  const raw = spec.key === "period" ? periodValue(values) : values[spec.key];
  const placement = spec.material_only ? "hidden" : (spec.default_placement ?? "trail");
  const format: ItemFormat = spec.format ?? "text";
  const source = sourceOf(profileSectionKey, spec.key);

  if (format === "authors") {
    const authors = authorsOf(values[spec.key === "inventors" ? "inventors" : "authors"] ?? raw);
    if (authors.length === 0) return [];
    const item: AuthorsItem = defaultAuthorsItem({
      key: spec.key,
      authors,
      placement,
    });
    return [item];
  }
  if (format === "date_range") {
    const value = asText(raw);
    if (value.trim() === "") return [];
    return [defaultFieldItem({ key: spec.key, value, placement, format: "date_range", source })];
  }
  if (format === "list") {
    const valuesList = asTextList(values[spec.key]);
    if (valuesList.length === 0) return [];
    return [defaultListItem({ key: spec.key, values: valuesList, placement })];
  }
  if (placement === "body" && LONG_TEXT_KEYS.has(spec.key)) {
    return textItemsOf(values[spec.key]);
  }
  const value =
    format === "enum" ? asText(raw) : typeof raw === "number" ? String(raw) : asText(raw);
  if (value.trim() === "") return [];
  if (format === "enum" && spec.enumOptions && !spec.enumOptions.some((o) => o.value === value)) {
    warnings.push(`unknown_enum:${sectionKey}.${spec.key}=${value}`);
  }
  return [
    defaultFieldItem({
      key: spec.key,
      value,
      placement,
      format,
      source,
      show_label: placement === "lead" || placement === "trail",
    }),
  ];
}

/** 自建板块：主文本成段、标签行成 trail 字段。 */
function buildCustomItems(input: ProfileFillInput, warnings: string[]): ResumeItem[] {
  const items: ResumeItem[] = [];
  const text = input.text ?? asText(input.values.text);
  if (text.trim() !== "") {
    items.push({ ...defaultTextItem(text.trim(), "paragraph"), hidden: false });
  }
  const lines = input.lines ?? [];
  for (const line of lines) {
    if (line.label.trim() === "" || line.value.trim() === "") continue;
    const key =
      line.key ??
      (line.field_id !== undefined ? `custom:${line.field_id}` : `custom:${newObjectId()}`);
    if (line.key === undefined && line.field_id === undefined) {
      warnings.push(`custom_field_missing_id:${line.label}`);
    }
    items.push(
      defaultFieldItem({
        key,
        label: line.label,
        value: line.value,
        placement: "trail",
        source: sourceOf(input.profileSectionKey, line.field_id ?? line.label),
      }),
    );
  }
  return items;
}

/**
 * 一条资料 → v2 items。
 *
 * 未在目录里的字段会进 `warnings`（不静默丢用户资料——调用方可以把它们显示成"未带入"）。
 */
export function convertFromProfile(input: ProfileFillInput): ConvertedItems {
  const warnings: string[] = [];
  if (input.sectionKey.startsWith("custom:")) {
    return { items: buildCustomItems(input, warnings), warnings };
  }
  const section = FALLBACK_SECTIONS.find(
    (candidate) =>
      candidate.key === input.sectionKey || candidate.profileSectionKey === input.profileSectionKey,
  );
  if (!section) {
    warnings.push(`unknown_section:${input.sectionKey}`);
    return { items: [], warnings };
  }
  const items: ResumeItem[] = [];
  const known = new Set<string>(["start_date", "end_date", "text", "lines"]);
  for (const spec of section.fields) {
    known.add(spec.key);
    items.push(
      ...buildItem(input.sectionKey, input.profileSectionKey, spec, input.values, warnings),
    );
  }
  for (const key of Object.keys(input.values)) {
    if (known.has(key) || DATE_END_KEYS.has(key)) continue;
    if (key === "id" || key === "hidden" || key === "lock_content" || key === "lock_layout")
      continue;
    if (asText(input.values[key]).trim() === "" && !Array.isArray(input.values[key])) continue;
    warnings.push(`unknown_field:${input.sectionKey}.${key}`);
  }
  return { items, warnings };
}

function isBlankValue(item: ResumeItem): boolean {
  switch (item.kind) {
    case "field":
      return item.value.trim() === "";
    case "list":
      return item.values.every((value) => value.trim() === "");
    case "authors":
      return item.authors.every((author) => author.name.trim() === "");
    case "text":
      return item.text.trim() === "";
    default:
      return true;
  }
}

/**
 * 把"从资料构造的 items"合并进现有 items：**只填空值、只追加缺失**。
 *
 * - 同 kind + 同 key 且当前值为空 → 用资料值补上（位置/顺序仍用用户当前的）；
 * - 当前没有这个字段 → 追加；
 * - 当前已有内容 → 不动。
 */
export function mergeProfileItems(
  current: readonly ResumeItem[],
  incoming: readonly ResumeItem[],
): { items: ResumeItem[]; filled: number } {
  const items = current.slice();
  let filled = 0;
  for (const candidate of incoming) {
    if (candidate.kind === "text") continue;
    const index = items.findIndex(
      (item) => item.kind === candidate.kind && item.key === candidate.key,
    );
    if (index < 0) {
      items.push(candidate);
      filled += 1;
      continue;
    }
    const existing = items[index];
    if (!isBlankValue(existing)) continue;
    items[index] = candidate;
    filled += 1;
  }
  return { items, filled };
}
