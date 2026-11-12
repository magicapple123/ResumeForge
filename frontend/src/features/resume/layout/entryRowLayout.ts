// SPDX-License-Identifier: Apache-2.0
/**
 * 灰字段「分侧」列布局的纯数据层（问题 4）。
 *
 * 正文前（lead）与正文后（trail）可以各有一套列数 / 对齐 / 分布 / 间距 / 逐列宽度：
 * v2 原来只有一套共用字段，业务上"正文前排 2 列、正文后排 3 列"做不到。本模块只放
 * **分侧**相关的生效值、覆盖判定与写回；共用字段（`entryLayoutModel` 里的
 * `effectiveColumns` 等）继续服务「共用」那一档。
 *
 * 继承链与后端 `_effective_row_layout` 逐项一致：
 *
 *     entry.lead.X ?? entry.X ?? section.lead.X ?? section.X ?? 默认值
 *
 * 条目共用值排在板块分侧值之前是刻意的：`entry.X` 是用户在这一条上做的决定，比板块级的
 * 分侧默认更近。
 */
import type {
  EntryLayout,
  ResumeDocument,
  ResumeEntry,
  RowLayout,
  SectionLayout,
} from "../../../types/resumeDocument";

export type LayoutColumns = 1 | 2 | 3;
export type LayoutAlign = "equal" | "flow";
export type LayoutJustify = "start" | "between";

/** 面板上的「对象」：共用一套 / 只管正文前 / 只管正文后。 */
export type LayoutSide = "shared" | "lead" | "trail";
/** 真正落在文档上的两种侧别（"shared" 不是侧别，是写回共用字段）。 */
export type RowSide = "lead" | "trail";

type SectionLike = ResumeDocument["sections"][number] | null | undefined;

/** 条目在某一侧自己覆盖了哪些项（null = 这一项从更外层继承）。 */
export interface SideOverrides {
  columns: boolean;
  align: boolean;
  justify: boolean;
  gap: boolean;
}

/** 某一层（条目/板块）上该侧的分侧布局；"shared" 没有分侧布局。 */
function sideLayer(
  layer: EntryLayout | SectionLayout | null | undefined,
  side: RowSide,
): RowLayout | null {
  return (layer?.[side] as RowLayout | null | undefined) ?? null;
}

/**
 * 分侧生效值（继承链）：`entry.lead.X ?? entry.X ?? section.lead.X ?? section.X ?? 默认`。
 *
 * 为什么条目共用值排在板块分侧值之前：条目自己那一套是用户在**这一条**上做的决定，
 * 比板块级的分侧默认更贴近使用场景（与后端 `_effective_row_layout` 同一口径）。
 */
function pickRowValue<K extends keyof RowLayout>(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
  name: K,
): RowLayout[K] | undefined {
  const layers = [
    sideLayer(entry?.layout, side),
    entry?.layout ?? null,
    sideLayer(section?.layout, side),
    section?.layout ?? null,
  ];
  for (const layer of layers) {
    const value = layer?.[name];
    if (value !== undefined && value !== null) return value as RowLayout[K];
  }
  return undefined;
}

/** 分侧的生效列数（默认 1）。 */
export function effectiveSideColumns(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): LayoutColumns {
  const value = pickRowValue(section, entry, side, "columns");
  return value === 2 || value === 3 ? value : 1;
}

/** 分侧的生效对齐（默认 equal）。 */
export function effectiveSideAlign(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): LayoutAlign {
  return pickRowValue(section, entry, side, "align") ?? "equal";
}

/** 分侧的生效分布（默认 start）。 */
export function effectiveSideJustify(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): LayoutJustify {
  return pickRowValue(section, entry, side, "justify") ?? "start";
}

/** 分侧的生效间距（字号倍数；null = 该对齐方式的兜底值）。 */
export function effectiveSideGap(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): number | null {
  return pickRowValue(section, entry, side, "gap") ?? null;
}

/** 分侧的逐列宽度；长度与分侧生效列数对不上时返回 null（与后端同口径）。 */
export function effectiveSideColumnWidths(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): number[] | null {
  const columns = effectiveSideColumns(section, entry, side);
  const widths = pickRowValue(section, entry, side, "column_widths") ?? null;
  return widths && widths.length === columns ? widths : null;
}

/** 分侧的逐间隔；长度必须是 columns − 1。 */
export function effectiveSideColumnGaps(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): number[] | null {
  const columns = effectiveSideColumns(section, entry, side);
  const gaps = pickRowValue(section, entry, side, "column_gaps") ?? null;
  return gaps && gaps.length === columns - 1 ? gaps : null;
}

/**
 * 「分布」开关在 UI 上是否可用。
 *
 * 与后端生效判据逐条对应：只有 equal、列数 > 1、且**没有**显式逐列宽度时才有剩余空间。
 * 宽度合计 100% 时开关无效，UI 负责禁用并说明原因（而不是让它看起来能点却没反应）。
 */
export function justifyAvailable(
  columns: LayoutColumns,
  align: LayoutAlign,
  widths: number[] | null,
): boolean {
  return align === "equal" && columns > 1 && widths === null;
}

/** 该侧当前写到哪一层（"entry" = 条目写了覆盖；"section" = 用板块值；"default" = 兜底）。 */
export function sideSource(
  section: SectionLike,
  entry: ResumeEntry | null | undefined,
  side: RowSide,
  name: keyof RowLayout,
): "entry" | "section" | "default" {
  if (sideLayer(entry?.layout, side)?.[name] != null) return "entry";
  if (entry?.layout?.[name as keyof EntryLayout] != null) return "entry";
  if (sideLayer(section?.layout, side)?.[name] != null) return "section";
  if (section?.layout?.[name as keyof SectionLayout] != null) return "section";
  return "default";
}

/** 该侧在文档里有没有字段（没有就不显示这一侧的选项，避免"调了没反应"）。 */
export function sideHasFields(entry: ResumeEntry | null | undefined, side: RowSide): boolean {
  if (!entry) return false;
  return entry.items.some((item) => item.kind !== "text" && (item.placement as string) === side);
}

/** 条目在某一侧自己覆盖了哪些项（null = 这一项从更外层继承）。 */
export function entrySideOverrides(
  entry: ResumeEntry | null | undefined,
  side: RowSide,
): SideOverrides {
  const layer = sideLayer(entry?.layout, side);
  return {
    columns: layer?.columns != null,
    align: layer?.align != null,
    justify: layer?.justify != null,
    gap: layer?.gap != null,
  };
}

/**
 * 不可变地改一个板块（写回用）。
 *
 * 为什么在这里自带一份而不从 `entryLayoutModel` 引：那个模块 `export * from "./entryRowLayout"`，
 * 反向 import 会形成循环依赖（Vite 会在运行时留下半初始化的模块）。实现与那边逐行一致。
 */
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

/**
 * 写回某一侧的列布局（问题 4）；`entryId` 为 null 时写板块级。
 *
 * 该侧的所有键都被清成 null 时把整个分侧对象删掉（= 回到"完全跟随共用字段"），
 * 否则文档里会留下一堆 `lead: {columns: null, …}` 的空壳，金标产物也会跟着变。
 */
export function patchRowLayout(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string | null,
  side: RowSide,
  patch: Partial<RowLayout>,
): ResumeDocument {
  const merge = (current: RowLayout | null | undefined): RowLayout | null => {
    const next: RowLayout = { ...(current ?? {}), ...patch };
    const empty = Object.values(next).every((value) => value === null || value === undefined);
    return empty ? null : next;
  };
  return mapSection(document, sectionKey, (section) => {
    if (entryId === null) {
      return {
        ...section,
        layout: { ...section.layout, [side]: merge(section.layout[side]) },
      } as ResumeDocument["sections"][number];
    }
    const index = section.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return section;
    const entries = section.entries.slice();
    entries[index] = {
      ...entries[index],
      layout: { ...entries[index].layout, [side]: merge(entries[index].layout[side]) },
    };
    return { ...section, entries };
  });
}
