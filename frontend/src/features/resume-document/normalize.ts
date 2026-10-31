// SPDX-License-Identifier: Apache-2.0
/**
 * v2 文档的归一化与对象身份补齐（纯函数）。
 *
 * ## 两个口径，别混用
 *
 * - `ensureIds`：只补缺失/非法 id，**不删任何东西**——编辑器打开文档、结构树建 key 用它；
 * - `normalizeDocument`：**读取/保存口径**——校验非法枚举落回默认值，并按后端 normalize 的
 *   规则去掉空 value / 空 entry / 空 section。编辑器每次 onChange 直接写整份文档，
 *   **不要**调它（否则用户刚"添加"的空字段会立刻消失）。
 *
 * 幂等：同一份文档连续调用两次结果逐字段相同（否则保存一次换一次 id）。
 */
import type {
  BodyStyle,
  EntryLayout,
  FieldItem,
  FieldSource,
  HeaderItem,
  ItemFormat,
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
  SectionLayout,
} from "../../types/resumeDocument";
import {
  HEADER_PLACEMENTS as HEADER_PLACEMENT_VALUES,
  ITEM_FORMATS as ITEM_FORMAT_VALUES,
  ITEM_PLACEMENTS,
} from "../../types/resumeDocument";
import { newObjectId } from "./identity";

/** 与后端 `OBJECT_ID_PATTERN` 同一口径：8–32 位字母、数字、下划线或连字符。 */
export const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

/** 测试可注入的 id 工厂；缺省用 `newObjectId`（15 位、满足上面的模式）。 */
export type IdFactory = () => string;

/** 生成一个新的对象 id（条目 / item 共用一套模式）。 */
export function newId(factory: IdFactory = newObjectId): string {
  return factory();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

function keepOrCreateId(value: unknown, factory: IdFactory): string {
  return isValidId(value) ? value : factory();
}

/** 校验位置：非法值落回 `trail`（后端默认位置，最少惊讶）。 */
export function asPlacement(value: unknown, fallback: Placement = "trail"): Placement {
  return typeof value === "string" && (ITEM_PLACEMENTS as readonly string[]).includes(value)
    ? (value as Placement)
    : fallback;
}

/** 校验格式：非法值落回 `text`。 */
export function asItemFormat(value: unknown, fallback: ItemFormat = "text"): ItemFormat {
  return typeof value === "string" && (ITEM_FORMAT_VALUES as readonly string[]).includes(value)
    ? (value as ItemFormat)
    : fallback;
}

function asHeaderPlacement(value: unknown): HeaderItem["placement"] {
  return typeof value === "string" && (HEADER_PLACEMENT_VALUES as readonly string[]).includes(value)
    ? (value as HeaderItem["placement"])
    : "hidden";
}

function asSource(value: unknown): FieldSource | null {
  if (!isRecord(value)) return null;
  const sectionKey = asText(value.section_key);
  const fieldId = value.field_id;
  if (sectionKey === "" || (typeof fieldId !== "string" && typeof fieldId !== "number"))
    return null;
  return { section_key: sectionKey, field_id: String(fieldId) };
}

function normalizeFieldItem(record: Record<string, unknown>, factory: IdFactory): FieldItem {
  return {
    kind: "field",
    id: keepOrCreateId(record.id, factory),
    key: asText(record.key),
    label: asText(record.label),
    value: asText(record.value),
    placement: asPlacement(record.placement),
    format: asItemFormat(record.format),
    wrap: record.wrap === "paren" ? "paren" : "none",
    show_label: record.show_label !== false,
    solo: record.solo === true,
    source: asSource(record.source),
    body_style: record.body_style === "paragraph" ? "paragraph" : "bullet",
  };
}

function normalizeListItem(record: Record<string, unknown>, factory: IdFactory): ResumeItem {
  const join =
    record.join === "comma" || record.join === "dot" || record.join === "inline"
      ? record.join
      : "semicolon";
  return {
    kind: "list",
    id: keepOrCreateId(record.id, factory),
    key: asText(record.key),
    label: asText(record.label),
    values: asTextList(record.values),
    placement: asPlacement(record.placement),
    join,
    show_label: record.show_label !== false,
    solo: record.solo === true,
    body_style: record.body_style === "paragraph" ? "paragraph" : "bullet",
  };
}

function normalizeAuthorsItem(record: Record<string, unknown>, factory: IdFactory): ResumeItem {
  const authors = Array.isArray(record.authors)
    ? record.authors.flatMap((author) => {
        if (!isRecord(author)) return [];
        return [
          {
            name: asText(author.name),
            is_self: author.is_self === true,
            corresponding: author.corresponding === true,
          },
        ];
      })
    : [];
  return {
    kind: "authors",
    id: keepOrCreateId(record.id, factory),
    key: asText(record.key),
    label: asText(record.label),
    authors,
    placement: asPlacement(record.placement),
    show_label: record.show_label === true,
    solo: record.solo === true,
  };
}

function normalizeTextItem(record: Record<string, unknown>, factory: IdFactory): ResumeItem {
  const style: BodyStyle = record.style === "paragraph" ? "paragraph" : "bullet";
  return {
    kind: "text",
    id: keepOrCreateId(record.id, factory),
    style,
    text: asText(record.text),
    hidden: record.hidden === true,
  };
}

/** 单个 item 的防御性归一化；未知 kind 返回 null（调用方丢弃，不猜语义）。 */
export function normalizeItem(value: unknown, factory: IdFactory = newObjectId): ResumeItem | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "field":
      return normalizeFieldItem(value, factory);
    case "list":
      return normalizeListItem(value, factory);
    case "authors":
      return normalizeAuthorsItem(value, factory);
    case "text":
      return normalizeTextItem(value, factory);
    default:
      return null;
  }
}

export function normalizeSectionLayout(value: unknown): SectionLayout {
  const record = isRecord(value) ? value : {};
  const columns = record.columns === 2 || record.columns === 3 ? record.columns : 1;
  return {
    columns,
    align: record.align === "flow" ? "flow" : "equal",
    gap: typeof record.gap === "number" && Number.isFinite(record.gap) ? record.gap : null,
    hide_title: record.hide_title === true,
    keep_together: record.keep_together === true,
    start_on_new_page: record.start_on_new_page === true,
    title_override: asText(record.title_override),
  };
}

export function normalizeEntryLayout(value: unknown): EntryLayout {
  const record = isRecord(value) ? value : {};
  const columns =
    record.columns === 1 || record.columns === 2 || record.columns === 3 ? record.columns : null;
  return {
    head: record.head === "stacked" || record.head === "meta_first" ? record.head : "split",
    columns,
    align: record.align === "equal" || record.align === "flow" ? record.align : null,
    gap: typeof record.gap === "number" && Number.isFinite(record.gap) ? record.gap : null,
    // 条目级分页（task-14）：只有显式 true 才打开；缺省/非法值一律 false（与后端默认值一致）。
    start_on_new_page: record.start_on_new_page === true,
    keep_together: record.keep_together === true,
  };
}

/** 归一化一条条目；未知 item 丢弃。**不补 id**（那是 ensureIds 的职责）。 */
export function normalizeEntry(value: unknown): ResumeEntry | null {
  if (!isRecord(value)) return null;
  const items = Array.isArray(value.items)
    ? value.items.flatMap((item) => {
        const normalized = normalizeItem(item);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id: isValidId(value.id) ? value.id : null,
    hidden: value.hidden === true,
    lock_content: value.lock_content === true,
    lock_layout: value.lock_layout === true,
    layout: normalizeEntryLayout(value.layout),
    items,
  };
}

/** 归一化一个板块（kind 非法落回 `entries`；title 空串 = 用目录标题）。 */
export function normalizeSection(value: unknown): ResumeSection | null {
  if (!isRecord(value)) return null;
  const key = asText(value.key);
  if (!key) return null;
  const kind = value.kind === "inline" || value.kind === "text" ? value.kind : ("entries" as const);
  const entries = Array.isArray(value.entries)
    ? value.entries.flatMap((entry) => {
        const normalized = normalizeEntry(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    key,
    title: asText(value.title),
    kind,
    layout: normalizeSectionLayout(value.layout),
    entries,
  };
}

function normalizeHeaderItem(value: unknown, factory: IdFactory): HeaderItem | null {
  if (!isRecord(value)) return null;
  return {
    kind: "field",
    id: keepOrCreateId(value.id, factory),
    key: asText(value.key),
    label: asText(value.label),
    value: asText(value.value),
    placement: asHeaderPlacement(value.placement),
    format: asItemFormat(value.format),
  };
}

/**
 * 补齐条目 / item / 页眉 item 的 id，返回**新对象**（不改入参）。
 *
 * 已有合法 id 一律不动；`factory` 只影响新生成的 id（测试用它钉住结果）。
 */
export function ensureIds(
  document: ResumeDocument,
  factory: IdFactory = newObjectId,
): ResumeDocument {
  return {
    ...document,
    header: {
      ...document.header,
      items: document.header.items.flatMap((item) => {
        const normalized = normalizeHeaderItem(item, factory);
        return normalized ? [normalized] : [];
      }),
    },
    sections: document.sections.map((section) => ({
      ...section,
      entries: section.entries.map((entry) => ({
        ...entry,
        id: isValidId(entry.id) ? entry.id : factory(),
        items: entry.items.map((item) =>
          isValidId(item.id) ? item : ({ ...item, id: factory() } as ResumeItem),
        ),
      })),
    })),
  };
}

/**
 * 文档里是否存在缺失/非法的 id（编辑器决定"要不要在打开时补一次"）。
 *
 * **必须有这个判据**：`ensureIds` 永远返回新对象，直接拿"返回引用变了"当判据会让打开
 * 一份完整文档也触发一次 onChange（工作台会因此标脏，用户什么都没改就亮起保存按钮）。
 */
export function needsIds(document: ResumeDocument): boolean {
  if (document.header.items.some((item) => !isValidId(item.id))) return true;
  return document.sections.some((section) =>
    section.entries.some(
      (entry) => !isValidId(entry.id) || entry.items.some((item) => !isValidId(item.id)),
    ),
  );
}

/** 一个 item 是否"有内容"（后端 normalize 的去空判据：字段看 value，文本看 text）。 */
export function itemHasContent(item: ResumeItem): boolean {
  switch (item.kind) {
    case "field":
      return item.value.trim() !== "";
    case "list":
      return item.values.some((value) => value.trim() !== "");
    case "authors":
      return item.authors.some((author) => author.name.trim() !== "");
    case "text":
      return item.text.trim() !== "";
    default:
      return false;
  }
}

export function entryHasContent(entry: ResumeEntry): boolean {
  return entry.items.some(itemHasContent);
}

/**
 * 读取/保存口径的归一化：
 * 1. 防御性归一化结构（非法枚举落默认值、未知 item 丢弃）；
 * 2. 补 id；
 * 3. 去掉空 item → 空 entry → 空 section（与后端 normalize 一致）。
 *
 * **编辑器每次 onChange 不要调它**（用户刚添加、还没填内容的字段会被删掉）；
 * 保存前由调用方显式调用，或在读取旧数据时调用。
 */
export function normalizeDocument(
  document: ResumeDocument,
  factory: IdFactory = newObjectId,
): ResumeDocument {
  const headerItems = document.header.items.flatMap((item) => {
    const normalized = normalizeHeaderItem(item, factory);
    return normalized ? [normalized] : [];
  });
  const sections = document.sections.flatMap((value) => {
    const section = normalizeSection(value);
    if (!section) return [];
    const entries = section.entries
      .map((entry) => ({ ...entry, items: entry.items.filter(itemHasContent) }))
      .filter((entry) => entry.items.length > 0);
    if (entries.length === 0) return [];
    return [{ ...section, entries }];
  });
  return ensureIds(
    { ...document, header: { ...document.header, items: headerItems }, sections },
    factory,
  );
}
