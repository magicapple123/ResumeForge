// SPDX-License-Identifier: Apache-2.0
/**
 * W4「条目字段排版」的**数据层**（纯函数，无 React）：`format_config.field_layout` 的读写与归一化。
 *
 * 为什么与面板拆开：面板需要导出常量/纯函数给测试用，而 React Fast Refresh 要求
 * `*.tsx` 只导出组件（`react-refresh/only-export-components`）。口径本身也不依赖渲染——
 * 后端 `resume_field_layout.py` 校验、四个渲染器装箱用的是同一套字段顺序与列数语义。
 *
 * 数据边界：
 * - 只写 `format_config.field_layout`，走既有 `withFormatDomain`（空域自动删键，R3）；
 * - 读侧做一次归一化：未知字段丢弃、未列出的补齐到末尾（与后端校验口径一致）；
 * - 全默认的分区视为"未配置"，不写空域（默认逐字段一行，产物零变化）。
 */
import { readFormatDomain, withFormatDomain } from "./formatDomains";
import type { MessageKey } from "../../i18n";
import type { ResumeLayout } from "../../types";

/** 允许调整字段排版的七个分区（与后端 `FIELD_LAYOUT_SECTIONS` 逐字一致）。 */
export const FIELD_LAYOUT_SECTIONS = [
  "education",
  "experience",
  "campus_experience",
  "projects",
  "awards",
  "publications",
  "research_projects",
] as const;

export type FieldLayoutSection = (typeof FIELD_LAYOUT_SECTIONS)[number];
export type FieldLayoutColumns = 1 | 2 | 3;

/** 一个分区的排版设置：列数 + 全量字段顺序 + 独占行字段。 */
export interface SectionFieldLayout {
  columns: FieldLayoutColumns;
  order: string[];
  solo: string[];
}

export type FieldLayoutMap = Partial<Record<FieldLayoutSection, SectionFieldLayout>>;

/** 落库形状（域内每个分区一个对象）。 */
interface StoredSectionFieldLayout {
  columns?: number;
  order?: string[];
  solo?: string[];
}

/** 各分区可调整的字段（顺序 = 默认顺序，与后端 `PROFILE_FIELD_ORDER` 一致）。 */
export const FIELD_LAYOUT_FIELDS: Record<FieldLayoutSection, readonly string[]> = {
  education: ["study_form", "degree_type", "department", "rank", "advisor", "research_direction"],
  experience: ["team_size"],
  campus_experience: ["activity_type"],
  projects: ["project_size"],
  awards: ["issuer", "level", "ratio"],
  publications: ["outcome_type", "my_rank"],
  research_projects: ["level"],
};

/** 字段标签复用编辑器既有词条（不新造一批同义词）。 */
export const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  "education:study_form": "editor.field.studyForm",
  "education:degree_type": "editor.field.degreeType",
  "education:department": "editor.field.department",
  "education:rank": "editor.field.classRank",
  "education:advisor": "editor.field.advisor",
  "education:research_direction": "editor.field.researchDirection",
  "experience:team_size": "editor.field.teamSize",
  "campus_experience:activity_type": "editor.field.activityType",
  "projects:project_size": "editor.field.projectSize",
  "awards:issuer": "editor.field.issuer",
  "awards:level": "editor.field.awardLevel",
  "awards:ratio": "editor.field.awardRatio",
  "publications:outcome_type": "research.publications.outcomeType",
  "publications:my_rank": "research.publications.myRank",
  "research_projects:level": "research.projects.level",
};

export const SECTION_LABEL_KEYS: Record<FieldLayoutSection, MessageKey> = {
  education: "outline.section.education",
  experience: "outline.section.experience",
  campus_experience: "outline.section.campus_experience",
  projects: "outline.section.projects",
  awards: "outline.section.awards",
  publications: "research.tab.publications",
  research_projects: "research.tab.projects",
};

export const COLUMN_LABEL_KEYS: Record<FieldLayoutColumns, MessageKey> = {
  1: "typography.fieldLayout.columns.1",
  2: "typography.fieldLayout.columns.2",
  3: "typography.fieldLayout.columns.3",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function clampColumns(raw: unknown): FieldLayoutColumns {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(Math.trunc(raw), 3)) as FieldLayoutColumns;
}

/** 该分区没有任何自定义（列数 1、默认顺序、无独占行）。 */
export function isSectionDefault(section: FieldLayoutSection, config: SectionFieldLayout): boolean {
  return (
    config.columns === 1 &&
    config.solo.length === 0 &&
    sameOrder(config.order, FIELD_LAYOUT_FIELDS[section])
  );
}

export function defaultSectionLayout(section: FieldLayoutSection): SectionFieldLayout {
  return { columns: 1, order: [...FIELD_LAYOUT_FIELDS[section]], solo: [] };
}

/** 读侧归一化：未知/重复字段丢弃，未列出的按默认顺序补末尾，solo 收敛为 order 子集。 */
export function normalizeSectionLayout(
  section: FieldLayoutSection,
  raw: unknown,
): SectionFieldLayout {
  if (!isRecord(raw)) return defaultSectionLayout(section);
  const defaults = FIELD_LAYOUT_FIELDS[section];
  const order: string[] = [];
  for (const item of Array.isArray(raw.order) ? raw.order : []) {
    if (typeof item === "string" && defaults.includes(item) && !order.includes(item)) {
      order.push(item);
    }
  }
  for (const field of defaults) {
    if (!order.includes(field)) order.push(field);
  }
  const rawSolo = Array.isArray(raw.solo) ? raw.solo : [];
  const solo = order.filter((field) => rawSolo.some((item) => item === field));
  return { columns: clampColumns(raw.columns), order, solo };
}

/** 读当前配置：只返回**有自定义**的分区（全默认的分区视为未配置）。 */
export function readFieldLayout(
  layout: Pick<ResumeLayout, "format_config"> | null | undefined,
): FieldLayoutMap {
  const domain = readFormatDomain(layout?.format_config, "field_layout");
  if (!domain) return {};
  const result: FieldLayoutMap = {};
  for (const section of FIELD_LAYOUT_SECTIONS) {
    const raw = domain[section];
    if (!isRecord(raw)) continue;
    const normalized = normalizeSectionLayout(section, raw);
    if (!isSectionDefault(section, normalized)) result[section] = normalized;
  }
  return result;
}

/**
 * 写入一个分区的设置（`null` = 恢复默认），返回**新的** ResumeLayout。
 *
 * 目录为空时 `withFormatDomain(null)` 会删掉整个域（R3：空域不落库）——所以"恢复默认"
 * 最终确实回到"从未设置"的产物（默认逐字段一行）。
 */
export function withSectionFieldLayout(
  layout: ResumeLayout,
  section: FieldLayoutSection,
  next: SectionFieldLayout | null,
): ResumeLayout {
  const current = readFieldLayout(layout);
  if (next === null || isSectionDefault(section, next)) {
    delete current[section];
  } else {
    current[section] = next;
  }
  const stored: Record<string, StoredSectionFieldLayout> = {};
  for (const key of FIELD_LAYOUT_SECTIONS) {
    const config = current[key];
    if (!config) continue;
    const entry: StoredSectionFieldLayout = { columns: config.columns };
    if (!sameOrder(config.order, FIELD_LAYOUT_FIELDS[key])) entry.order = config.order;
    if (config.solo.length > 0) entry.solo = config.solo;
    stored[key] = entry;
  }
  const domain = Object.keys(stored).length > 0 ? stored : null;
  return {
    ...layout,
    format_config: withFormatDomain(layout.format_config, "field_layout", domain),
  };
}

/** 字段上移/下移一格（越界返回原顺序，调用方已按边界禁用按钮）。 */
export function moveField(order: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function fieldLabelKey(section: FieldLayoutSection, field: string): MessageKey {
  return FIELD_LABEL_KEYS[`${section}:${field}`] ?? "editor.field.summary";
}
