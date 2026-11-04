// SPDX-License-Identifier: Apache-2.0
/**
 * 简历文档模型 v2 的 TS 类型：与后端 `backend/app/schemas/resume_document.py` 一一对应。
 *
 * 核心口径（计划 D1–D12）：
 * - items 是一条有序列表，位置（title/meta/lead/trail/body/hidden）是 item 上的数据；
 *   拖拽 = 改顺序 + 改 placement，hidden = 数据保留但不上纸面；
 * - header / section / entry 三层容器；自建板块与系统板块同构；
 * - 字段存规范值 + format，显示时再格式化（日期/枚举/列表/作者/URL）；
 * - 渲染/排版由后端 planner 统一决定，前端只做编辑与结构视图。
 *
 * 与 v1 的分界：`types/resume.ts` 里旧的 ResumeContent 只给尚未迁移的模块（delivery /
 * bilingual 内部）做兼容视图；制作台、预览、导出、编辑器一律使用本文件的 v2 类型。
 */

export type Placement = "title" | "meta" | "lead" | "trail" | "body" | "hidden";
export type HeaderPlacement = "name" | "name_meta" | "subtitle" | "contact" | "photo" | "hidden";
export type ItemFormat =
  "text" | "date" | "date_range" | "list" | "enum" | "url" | "authors" | "number";
export type SectionKind = "entries" | "inline" | "text";
export type HeadLayout = "split" | "stacked" | "meta_first";
export type ItemWrap = "none" | "paren";
export type ItemJoin = "comma" | "semicolon" | "dot" | "inline";
export type BodyStyle = "bullet" | "paragraph";
export type ResumeLanguageCode = "zh-CN" | "en-US";

export const DOCUMENT_VERSION = 2 as const;
export const ITEM_PLACEMENTS: readonly Placement[] = [
  "title",
  "meta",
  "lead",
  "trail",
  "body",
  "hidden",
];
export const HEADER_PLACEMENTS: readonly HeaderPlacement[] = [
  "name",
  "name_meta",
  "subtitle",
  "contact",
  "photo",
  "hidden",
];
export const ITEM_FORMATS: readonly ItemFormat[] = [
  "text",
  "date",
  "date_range",
  "list",
  "enum",
  "url",
  "authors",
  "number",
];
export const HEAD_LAYOUTS: readonly HeadLayout[] = ["split", "stacked", "meta_first"];

export interface FieldSource {
  section_key: string;
  field_id: string;
}

interface ItemBase {
  id: string;
  placement: Placement;
  show_label: boolean;
  solo: boolean;
  /** 隐藏前的位置：隐藏后再显示时恢复到此处，而不是追加到 trail。 */
  hidden_from?: Placement | null;
}

export interface FieldItem extends ItemBase {
  kind: "field";
  key: string;
  label: string;
  value: string;
  format: ItemFormat;
  wrap: ItemWrap;
  body_style: BodyStyle;
  source?: FieldSource | null;
}

export interface ListItem extends ItemBase {
  kind: "list";
  key: string;
  label: string;
  values: string[];
  join: ItemJoin;
  body_style: BodyStyle;
}

export interface ResumeAuthor {
  name: string;
  is_self: boolean;
  corresponding: boolean;
}

export interface AuthorsItem extends ItemBase {
  kind: "authors";
  key: string;
  label: string;
  authors: ResumeAuthor[];
}

export interface TextItem {
  kind: "text";
  id: string;
  style: BodyStyle;
  text: string;
  hidden: boolean;
}

export type ResumeItem = FieldItem | ListItem | AuthorsItem | TextItem;

export interface HeaderItem {
  kind: "field";
  id: string;
  key: string;
  label: string;
  value: string;
  placement: HeaderPlacement;
  format: ItemFormat;
}

export interface ResumeHeader {
  items: HeaderItem[];
  contact_breaks: string[];
}

/**
 * 一组灰字段（正文前 lead / 正文后 trail）的列布局（问题 4）。
 *
 * 全部字段可空：null/缺省 = 这一层没设置，继续往继承链上一层找
 * （`entry.lead.X ?? entry.X ?? section.lead.X ?? section.X ?? 默认值`）。
 */
export interface RowLayout {
  columns?: 1 | 2 | 3 | null;
  align?: "equal" | "flow" | null;
  /** 分布：start = 列宽按内容、整体靠左；between = 剩余空白均分到列之间（末列贴右边界）。 */
  justify?: "start" | "between" | null;
  gap?: number | null;
  column_widths?: number[] | null;
  column_gaps?: number[] | null;
}

export interface SectionLayout {
  columns: 1 | 2 | 3;
  align: "equal" | "flow";
  gap: number | null;
  /** 分布（问题 4）：只在 equal + 多列 + 没有显式逐列宽度时生效。缺省 = start。 */
  justify?: "start" | "between";
  /** 逐列宽度（百分比，合计 100；长度必须等于 columns）。null/缺省 = 等宽。 */
  column_widths?: number[] | null;
  /** 逐间隔（字号倍数；长度必须等于 columns − 1）。null/缺省 = 统一用 gap。 */
  column_gaps?: number[] | null;
  /** 正文前 / 正文后各自的列布局（问题 4）。缺省 = 完全跟随上面的共用字段。 */
  lead?: RowLayout | null;
  trail?: RowLayout | null;
  hide_title: boolean;
  keep_together: boolean;
  start_on_new_page: boolean;
  title_override: string;
}

export interface EntryLayout {
  head: HeadLayout;
  columns?: 1 | 2 | 3 | null;
  align?: "equal" | "flow" | null;
  /** 分布（问题 4）；null = 继承分区。 */
  justify?: "start" | "between" | null;
  gap?: number | null;
  /** 与分区级同口径；条目级可单独覆盖，null = 继承分区。 */
  column_widths?: number[] | null;
  column_gaps?: number[] | null;
  /** 正文前 / 正文后各自的列布局（问题 4）；null = 继承分区（含分区级的分侧值）。 */
  lead?: RowLayout | null;
  trail?: RowLayout | null;
  /** 条目级分页（计划 §6.2）：true = 该条目另起一页；与分区级取「或」。缺省 = false。 */
  start_on_new_page?: boolean;
  /** 条目级分页：true = 尽量让该条目整条不跨页；与分区级取「或」。缺省 = false。 */
  keep_together?: boolean;
}

export interface ResumeEntry {
  id?: string | null;
  hidden: boolean;
  lock_content: boolean;
  lock_layout: boolean;
  layout: EntryLayout;
  items: ResumeItem[];
}

export interface ResumeSection {
  key: string;
  title: string;
  kind: SectionKind;
  layout: SectionLayout;
  entries: ResumeEntry[];
}

export interface ResumeDocument {
  version: 2;
  language: ResumeLanguageCode;
  header: ResumeHeader;
  sections: ResumeSection[];
}

// ===== planner 输出（后端生成；精确预览/结构视图可消费）=====

export type InlineRole = "name" | "section_title" | "entry_title" | "body" | "meta" | "emphasis";

export interface InlineSegment {
  text: string;
  role: InlineRole | string;
  strong: boolean;
  /** #5d：斜体已移除；旧 planner 输出里的该字段前端不再消费。 */
  italic?: boolean;
  link?: string | null;
  path: string;
}

export interface CellPlan {
  segments: InlineSegment[];
  solo: boolean;
}

export interface BlockPlan {
  kind: BodyStyle;
  segments: InlineSegment[];
  path: string;
}

export interface HeadPlan {
  layout: HeadLayout;
  title: InlineSegment[];
  meta: InlineSegment[];
  path: string;
}

export interface EntryPlan {
  id: string;
  layout: EntryLayout;
  head: HeadPlan;
  lead_rows: CellPlan[][];
  body: BlockPlan[];
  trail_rows: CellPlan[][];
}

export interface SectionPlan {
  key: string;
  title: string;
  kind: SectionKind;
  layout: SectionLayout;
  entries: EntryPlan[];
  rows: CellPlan[][];
  row_separator: string;
}

export interface HeaderPlan {
  name: InlineSegment[];
  name_meta: InlineSegment[];
  subtitle: InlineSegment[];
  contact_lines: InlineSegment[][];
  photo?: string | null;
}

export interface DocumentPlan {
  language: string;
  header: HeaderPlan;
  sections: SectionPlan[];
}

// ===== 字段目录（GET /api/profile/field-placement-catalog；资料页与制作台共用）=====

export interface FieldCatalogField {
  key: string;
  label: string;
  format: ItemFormat;
  field_type: string;
  default_placement: Placement;
  material_only: boolean;
  private: boolean;
  source_field_id: string;
}

export interface FieldCatalogSection {
  key: string;
  title: string;
  title_key: string;
  kind: SectionKind;
  profile_section_key: string;
  material_only: boolean;
  fields: FieldCatalogField[];
}

export interface HeaderCatalogField {
  key: string;
  label: string;
  placement: HeaderPlacement;
  format: ItemFormat;
  source_field_id: string;
  /**
   * 资料里这个字段的**当前值**（6-A）：可选，旧后端 / 目录兜底不下发时按空串处理。
   *
   * 这是**拷贝**而不是活链接——「添加页眉字段」把它写进 `HeaderItem.value` 之后，
   * 资料再改不会回写（`HeaderItem` 没有 source 字段）。私密 / 隐藏字段后端根本不下发值，
   * 因此这里为空是正常结果，不是缺数据。
   */
  value?: string;
}

export interface DocumentFieldCatalog {
  sections: FieldCatalogSection[];
  header_fields: HeaderCatalogField[];
}

// ===== 路径（预览定位 / 编辑器选中 / 结构视图共用）=====

/** section = key；entry = section.entry_id；item = section.entry_id.item_id；header = header.item_id。 */
export type ResumePath = string;

export interface ParsedResumePath {
  kind: "header" | "section" | "entry" | "item";
  sectionKey?: string;
  entryId?: string;
  itemId?: string;
}
