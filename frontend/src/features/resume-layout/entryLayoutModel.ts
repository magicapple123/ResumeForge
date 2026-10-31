// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板的**纯数据层**（v2 文档模型）。
 *
 * 与旧 `features/resume-layout/fieldLayout.ts`（v1 七分区 field_layout）的关系：
 * - 旧模块管的是 `format_config.field_layout` 的读写，v2 里布局已经**长在文档上**
 *   （`section.layout` / `entry.layout`），所以这里不再有"七分区白名单"，板块来自
 *   `document.sections`（含自建板块）；
 * - 写操作复用 `features/resume-document/placement` 的不可变实现，本模块只组装
 *   "面板需要看到什么"（选项、生效值、短字段行）与"改一份布局要 patch 哪一层"。
 *
 * 生效值遵循继承链：entry.layout 的字段是 `null` 时继承 section.layout，NULL 表示
 * "没单独设置"而不是"值为空"——面板上「跟随板块」与「显式设为默认值」是两回事。
 */
import type {
  EntryLayout,
  HeadLayout,
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  SectionLayout,
} from "../../types/resumeDocument";
import { defaultEntryLayout, defaultSectionLayout } from "../resume-document/defaults";
import { moveItem, reorderItems } from "../resume-document/placement";
import { formatListValues } from "../resume-document/format";
import { t } from "../../i18n";
import { itemPath } from "../resume-document/paths";

export type LayoutColumns = 1 | 2 | 3;
export type LayoutAlign = "equal" | "flow";

/** 条目下拉的一个选项；`label` 用条目标题行里第一个非空字段，全空时退回「条目 N」。 */
export interface EntryOption {
  id: string;
  label: string;
}

/** 灰色短字段行（lead / trail），顺序 = 纸上从左到右的排列。 */
export interface ShortFieldRow {
  /** 文档路径（`{section}.{entry}.{item}`）：面板按它调 placement 操作。 */
  path: string;
  itemId: string;
  /** 显示名：item.label 优先，空时用 key（字段目录未下发时的兜底）。 */
  label: string;
  key: string;
  /** lead = 正文前灰字 / trail = 正文后灰字。 */
  placement: "lead" | "trail";
  solo: boolean;
  showLabel: boolean;
  /** 值预览（列表拼成一行；太长由 UI 截断）。 */
  preview: string;
}

function itemLabel(item: ResumeItem, resolveLabel?: (key: string) => string | undefined): string {
  if (item.kind === "text") return "";
  const explicit = item.label.trim();
  if (explicit) return explicit;
  const fromCatalog = resolveLabel?.(item.key)?.trim();
  return fromCatalog || item.key;
}

/** item 的值预览（作者与列表各拼一行；字段直接取 value）。 */
export function itemPreview(item: ResumeItem): string {
  switch (item.kind) {
    case "field":
      return item.value;
    case "list":
      return formatListValues(item.values, item.join);
    case "authors":
      return item.authors
        .map((author) =>
          author.is_self ? `${author.name} (${t("research.authors.self")})` : author.name,
        )
        .filter(Boolean)
        .join(", ");
    case "text":
      return item.text;
    default:
      return "";
  }
}

/** 条目在纸面上的标题：title 位置字段值按顺序拼；都没有时返回空串。 */
export function entryTitle(entry: ResumeEntry): string {
  return entry.items
    .filter((item): item is Extract<ResumeItem, { kind: "field" }> => item.kind === "field")
    .filter((item) => item.placement === "title")
    .map((item) => item.value.trim())
    .filter(Boolean)
    .join("\u00B7");
}

/** 板块的条目下拉（顺序 = 文档顺序；标签 = 标题行，空时「条目 N」）。 */
export function entryOptions(
  document: ResumeDocument,
  sectionKey: string,
  untitledFallback: string,
): EntryOption[] {
  const section = document.sections.find((candidate) => candidate.key === sectionKey);
  if (!section) return [];
  return section.entries.map((entry, index) => {
    const title = entryTitle(entry);
    const label = title || `${untitledFallback} ${index + 1}`;
    return { id: entry.id ?? "", label };
  });
}

/** 板块级"灰字段顺序"的行数据（lead 在前、trail 在后，各自保持文档顺序）。 */
export function shortFieldRows(
  entry: ResumeEntry | null | undefined,
  sectionKey: string,
  resolveLabel?: (key: string) => string | undefined,
): ShortFieldRow[] {
  if (!entry) return [];
  const rows: ShortFieldRow[] = [];
  for (const item of entry.items) {
    if (item.kind !== "field" && item.kind !== "list" && item.kind !== "authors") continue;
    const placement = item.placement;
    if (placement !== "lead" && placement !== "trail") continue;
    rows.push({
      path: itemPath(sectionKey, entry.id ?? "", item.id),
      itemId: item.id,
      label: itemLabel(item, resolveLabel),
      key: item.key,
      placement,
      solo: item.kind === "authors" ? false : item.solo,
      showLabel: item.show_label,
      preview: itemPreview(item),
    });
  }
  // lead 组整体排在 trail 组前：面板分组展示，组内顺序就是纸面顺序。
  return rows.sort((left, right) =>
    left.placement === right.placement ? 0 : left.placement === "lead" ? -1 : 1,
  );
}

// ── 生效值（继承链）────────────────────────────────────────────

export function effectiveHead(entry: ResumeEntry | null | undefined): HeadLayout {
  return entry?.layout.head ?? "split";
}

/** entry 覆盖 → section 默认 → 1。 */
export function effectiveColumns(
  section: ResumeDocument["sections"][number] | null | undefined,
  entry: ResumeEntry | null | undefined,
): LayoutColumns {
  const value = entry?.layout.columns ?? section?.layout.columns ?? 1;
  return value === 2 || value === 3 ? value : 1;
}

export function effectiveAlign(
  section: ResumeDocument["sections"][number] | null | undefined,
  entry: ResumeEntry | null | undefined,
): LayoutAlign {
  return entry?.layout.align ?? section?.layout.align ?? "equal";
}

/** gap 是"字号倍数"；null = 该对齐方式的兜底值，面板显示为空并用占位符说明。 */
export function effectiveGap(
  section: ResumeDocument["sections"][number] | null | undefined,
  entry: ResumeEntry | null | undefined,
): number | null {
  return entry?.layout.gap ?? section?.layout.gap ?? null;
}

// ── 写回（不可变）─────────────────────────────────────────────

function mapSection(
  document: ResumeDocument,
  sectionKey: string,
  updater: (section: ResumeDocument["sections"][number]) => ResumeDocument["sections"][number],
): ResumeDocument {
  const index = document.sections.findIndex((section) => section.key === sectionKey);
  if (index < 0) return document;
  const sections = document.sections.slice();
  sections[index] = updater(sections[index]);
  return { ...document, sections } as ResumeDocument;
}

/** 区块级布局 patch（只合并传入的键）。 */
export function patchSectionLayout(
  document: ResumeDocument,
  sectionKey: string,
  patch: Partial<SectionLayout>,
): ResumeDocument {
  return mapSection(document, sectionKey, (section) => ({
    ...section,
    layout: { ...section.layout, ...patch },
  }));
}

/** 条目级布局 patch；传 `null` 的键表示"恢复继承"（EntryLayout 用 null 表达没单独设置）。 */
export function patchEntryLayout(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string,
  patch: Partial<EntryLayout>,
): ResumeDocument {
  return mapSection(document, sectionKey, (section) => {
    const index = section.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return section;
    const entries = section.entries.slice();
    entries[index] = { ...entries[index], layout: { ...entries[index].layout, ...patch } };
    return { ...section, entries };
  });
}

/** 板块布局恢复默认。 */
export function resetSectionLayout(document: ResumeDocument, sectionKey: string): ResumeDocument {
  return mapSection(document, sectionKey, (section) => ({
    ...section,
    layout: defaultSectionLayout(),
  }));
}

/** 条目布局恢复继承（不是"恢复默认值"：连 `head` 也回到 split 同时继承分区列数）。 */
export function resetEntryLayout(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string,
): ResumeDocument {
  return patchEntryLayout(document, sectionKey, entryId, defaultEntryLayout());
}

// ── 继承链可视化（P5-4）──────────────────────────────────────

/** 条目级可继承项：只有这三项能从板块默认继承；head 是条目自己的属性。 */
export type InheritableLayoutField = "columns" | "align" | "gap";

/** 条目自己覆盖了哪些可继承项（null = 这一项继承板块）。 */
export interface EntryLayoutOverrides {
  columns: boolean;
  align: boolean;
  gap: boolean;
}

export function entryLayoutOverrides(entry: ResumeEntry | null | undefined): EntryLayoutOverrides {
  return {
    columns: entry?.layout.columns != null,
    align: entry?.layout.align != null,
    gap: entry?.layout.gap != null,
  };
}

/**
 * 逐项「恢复继承」：只把这一项置回 null（= 继承板块），
 * **不写 section.layout**，也不动同一条目的其它覆盖项。
 */
export function restoreEntryLayoutField(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string,
  field: InheritableLayoutField,
): ResumeDocument {
  return patchEntryLayout(document, sectionKey, entryId, {
    [field]: null,
  } as Partial<EntryLayout>);
}

/**
 * 把灰色短字段在纸上挪一格（**同组内**上/下移）；到边界返回原文档引用。
 * 跨位置分组是拖拽 / `setPlacement` 的职责，方向键不替用户做位置决定。
 */
export function moveShortField(
  document: ResumeDocument,
  path: string,
  delta: -1 | 1,
): ResumeDocument {
  return reorderItems(document, path, delta);
}

/** 切换短字段显示/隐藏（hidden 位置保留数据、不上纸面）。 */
export function toggleShortFieldHidden(
  document: ResumeDocument,
  path: string,
  item: ResumeItem,
): ResumeDocument {
  const placement: Placement =
    item.kind !== "text" && item.placement === "hidden" ? "trail" : "hidden";
  return moveItem(document, path, { placement });
}

/** 该板块是否有条目（决定条目下拉是否可用）；inline/text 板块没有条目概念。 */
export function hasEntries(
  section: ResumeDocument["sections"][number] | null | undefined,
): boolean {
  return (section?.entries?.length ?? 0) > 0;
}
