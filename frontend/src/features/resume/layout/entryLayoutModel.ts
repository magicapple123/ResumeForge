// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板的**纯数据层**（v2 文档模型）。
 *
 * 与旧 `features/resume/layout/fieldLayout.ts`（v1 七分区 field_layout）的关系：
 * - 旧模块管的是 `format_config.field_layout` 的读写，v2 里布局已经**长在文档上**
 *   （`section.layout` / `entry.layout`），所以这里不再有"七分区白名单"，板块来自
 *   `document.sections`（含自建板块）；
 * - 写操作复用 `features/resume/document/placement` 的不可变实现，本模块只组装
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
} from "../../../types/resumeDocument";
import { defaultEntryLayout, defaultSectionLayout } from "../document/defaults";
import { moveItem, reorderItems } from "../document/placement";
import { formatListValues } from "../document/format";
import { t } from "../../../i18n";
import { itemPath } from "../document/paths";
import type { LayoutColumns, LayoutAlign, LayoutJustify } from "./entryRowLayout";
export * from "./entryRowLayout";

/** 条目下拉的一个选项；`label` 用条目标题行里第一个非空字段，全空时退回「条目 N」。 */
export interface EntryOption {
  id: string;
  label: string;
}

/** 灰色短字段行（正文前 / 正文后的灰字）。顺序 = `entry.items` 原序。 */
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
  /** `authors` 没有「独占一行」语义（它总是在元信息行里整行排），面板据此禁用该项。 */
  canSolo: boolean;
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

/**
 * 灰色短字段行（顺序 = **`entry.items` 原序**，不按 placement 分组）。
 *
 * R-10（审计）：旧实现把 lead 组整体排到 trail 组之前，导致"把某行切到正文前"时
 * 这一行会从列表底部跳到顶部——用户视线与滚动位置都被甩走。现在顺序与 items 一致，
 * 每行的 `[前|后]` 只改去向、不重排列表；纸上仍按 lead → 正文 → trail 渲染
 * （planner 负责），所以"行顺序"承担正交的另一件事：同一组内的先后。
 */
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
      canSolo: item.kind !== "authors",
      preview: itemPreview(item),
    });
  }
  return rows;
}

// ── 生效值（继承链）────────────────────────────────────────────

export function effectiveHead(entry: ResumeEntry | null | undefined): HeadLayout {
  return entry?.layout.head ?? "split";
}

// ── 分侧（正文前 / 正文后）生效值（问题 4）────────────────────────

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

/**
 * 「分布」的生效值（问题 4）：`entry.justify ?? section.justify ?? "start"`。
 *
 * 这是**共用**那一档；分侧（正文前 / 正文后）走 `entryRowLayout.effectiveSideJustify`。
 * `start` 是拆开之前的唯一行为，所以旧文档（字段缺省）在面板上显示「靠左」。
 */
export function effectiveJustify(
  section: ResumeDocument["sections"][number] | null | undefined,
  entry: ResumeEntry | null | undefined,
): LayoutJustify {
  return entry?.layout.justify ?? section?.layout.justify ?? "start";
}

/**
 * 逐列宽度（百分比）/ 逐间隔（字号倍数）的生效值（任务 13）。
 *
 * 长度与生效列数对不上时返回 null：后端 `resolved_column_geometry` 也是这条口径
 * （整体作废、回落等宽），两边必须一致，否则面板显示"已设宽度"而纸面按等宽排。
 */
export function effectiveColumnWidths(
  section: ResumeDocument["sections"][number] | null | undefined,
  entry: ResumeEntry | null | undefined,
): number[] | null {
  const columns = effectiveColumns(section, entry);
  const widths = entry?.layout.column_widths ?? section?.layout.column_widths ?? null;
  return widths && widths.length === columns ? widths : null;
}

export function effectiveColumnGaps(
  section: ResumeDocument["sections"][number] | null | undefined,
  entry: ResumeEntry | null | undefined,
): number[] | null {
  const columns = effectiveColumns(section, entry);
  const gaps = entry?.layout.column_gaps ?? section?.layout.column_gaps ?? null;
  return gaps && gaps.length === columns - 1 ? gaps : null;
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

/** 条目级可继承项：只有这四项能从板块默认继承；head 是条目自己的属性。 */
export type InheritableLayoutField = "columns" | "align" | "justify" | "gap";

/** 条目自己覆盖了哪些可继承项（null = 这一项继承板块）。 */
export interface EntryLayoutOverrides {
  columns: boolean;
  align: boolean;
  justify: boolean;
  gap: boolean;
}

export function entryLayoutOverrides(entry: ResumeEntry | null | undefined): EntryLayoutOverrides {
  return {
    columns: entry?.layout.columns != null,
    align: entry?.layout.align != null,
    justify: entry?.layout.justify != null,
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
