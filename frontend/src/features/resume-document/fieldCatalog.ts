// SPDX-License-Identifier: Apache-2.0
/**
 * 字段目录的查询与构造（纯函数）。
 *
 * 唯一真相在后端 `GET /api/profile/field-placement-catalog`；本文件与
 * `fieldCatalogData.ts` 只是旧后端 / 接口失败 / 组件单测时的兜底。数据表在
 * fieldCatalogData.ts（守 500 行预算），这里只放"怎么用"。
 */
import type { MessageKey } from "../../i18n";
import type {
  DocumentFieldCatalog,
  FieldCatalogField,
  FieldCatalogSection,
  FieldSource,
  ItemFormat,
  ResumeSection,
} from "../../types/resumeDocument";
import {
  FALLBACK_HEADER_FIELDS,
  FALLBACK_SECTIONS,
  type FallbackFieldSpec,
  type FallbackSectionSpec,
} from "./fieldCatalogData";

export { FALLBACK_HEADER_FIELDS, FALLBACK_SECTIONS, fallbackFormatOf } from "./fieldCatalogData";
export type { FallbackFieldSpec, FallbackSectionSpec } from "./fieldCatalogData";

function toFieldSpec(
  section: FallbackSectionSpec,
  spec: FallbackFieldSpec,
  resolve: (key: MessageKey) => string,
): FieldCatalogField {
  return {
    key: spec.key,
    label: resolve(spec.labelKey),
    format: spec.format ?? "text",
    field_type: spec.format === "list" ? "list" : "single_line",
    default_placement: spec.default_placement ?? "trail",
    material_only: spec.material_only === true,
    private: false,
    source_field_id: `${section.profileSectionKey}.${spec.key}`,
  };
}

function toSection(
  section: FallbackSectionSpec,
  resolve: (key: MessageKey) => string,
): FieldCatalogSection {
  return {
    key: section.key,
    title: resolve(section.titleKey),
    title_key: section.key,
    kind: section.kind,
    profile_section_key: section.profileSectionKey,
    material_only: false,
    fields: section.fields.map((field) => toFieldSpec(section, field, resolve)),
  };
}

/** 用当前语言构造 fallback 目录（`resolve` 传 `t`）。真实目录永远优先。 */
export function buildFallbackCatalog(resolve: (key: MessageKey) => string): DocumentFieldCatalog {
  return {
    sections: FALLBACK_SECTIONS.map((section) => toSection(section, resolve)),
    header_fields: FALLBACK_HEADER_FIELDS.map((field) => ({
      key: field.key,
      label: resolve(field.labelKey),
      placement: field.placement,
      format: field.format ?? "text",
      source_field_id: field.key,
    })),
  };
}

/** 按板块的 key / 资料分区键找目录条目（两种都要认：前端用文档里的 section.key）。 */
export function catalogSectionOf(
  catalog: DocumentFieldCatalog | null | undefined,
  sectionKeyOrProfileKey: string,
): FieldCatalogSection | null {
  if (!catalog) return null;
  return (
    catalog.sections.find(
      (section) =>
        section.key === sectionKeyOrProfileKey ||
        section.profile_section_key === sectionKeyOrProfileKey,
    ) ?? null
  );
}

/** 这个板块的字段目录（找不到返回空数组）。 */
export function catalogFieldsOf(
  catalog: DocumentFieldCatalog | null | undefined,
  sectionKeyOrProfileKey: string,
): FieldCatalogField[] {
  return catalogSectionOf(catalog, sectionKeyOrProfileKey)?.fields ?? [];
}

/** 已存在于文档里的字段 key 集合 → 菜单里只剩"还没加的"（同 key 允许重复，但内置 key 只加一次）。 */
export function missingFieldSpecs(
  catalog: DocumentFieldCatalog | null | undefined,
  section: ResumeSection,
): FieldCatalogField[] {
  const specs = catalogFieldsOf(catalog, section.key);
  const used = new Set<string>();
  for (const entry of section.entries) {
    for (const item of entry.items) {
      if (item.kind !== "text") used.add(item.key);
    }
  }
  return specs.filter((spec) => !used.has(spec.key));
}

/**
 * 枚举字段的「家族表」：fallback 目录里每个 enum 字段就是一张 值→文案 表。
 *
 * 4 类枚举（工作类型 / 发表状态 / 专利状态 / 凭证状态）各自一张；结构上是
 * (板块 key 集合, 字段 key, 选项表)。
 */
interface EnumTable {
  sectionKeys: readonly string[];
  fieldKey: string;
  options: readonly { value: string; labelKey: MessageKey }[];
}

const ENUM_TABLES: readonly EnumTable[] = FALLBACK_SECTIONS.flatMap((section) =>
  section.fields
    .filter((field) => field.format === "enum" && (field.enumOptions?.length ?? 0) > 0)
    .map((field) => ({
      sectionKeys: [section.key, section.profileSectionKey],
      fieldKey: field.key,
      options: field.enumOptions ?? [],
    })),
);

/**
 * 文档里的板块 key 变体 → fallback 板块 key。
 *
 * 目录里的 key 是唯一真相（`document_catalog.py` 的 SECTION_ORDER：publications/patents/
 * credentials…），但历史简历与资料分区键会出现单数 / 别名写法；枚举本地化不能因为一个
 * `patent` 与 `patents` 的差别就把 `granted` 裸显出来。
 */
const SECTION_ALIASES: Record<string, string> = {
  experiences: "experience",
  work_experiences: "experience",
  publication: "publications",
  patent: "patents",
  credential: "credentials",
  certificates: "credentials",
};

function enumTableFor(sectionKey: string, fieldKey: string): EnumTable | undefined {
  const key = SECTION_ALIASES[sectionKey] ?? sectionKey;
  return ENUM_TABLES.find(
    (table) => table.sectionKeys.includes(key) && table.fieldKey === fieldKey,
  );
}

function enumTableForSection(sectionKey: string): EnumTable | undefined {
  const key = SECTION_ALIASES[sectionKey] ?? sectionKey;
  return ENUM_TABLES.find((table) => table.sectionKeys.includes(key));
}

/**
 * 全局「值 → 文案 key」索引：A5（自建板块 / 新加的枚举字段）没有目录表可查时，
 * `full_time` 这类**跨家族唯一**的 code 仍然能翻；`pending` 这类不同家族文案不同的
 * 值宁可回退原值也不猜（猜错比露 code 更糟）。
 */
const ENUM_VALUE_INDEX = new Map<string, { labelKeys: Set<MessageKey>; tables: EnumTable[] }>();
for (const table of ENUM_TABLES) {
  for (const option of table.options) {
    const entry = ENUM_VALUE_INDEX.get(option.value) ?? {
      labelKeys: new Set<MessageKey>(),
      tables: [] as EnumTable[],
    };
    entry.labelKeys.add(option.labelKey);
    if (!entry.tables.includes(table)) entry.tables.push(table);
    ENUM_VALUE_INDEX.set(option.value, entry);
  }
}

function localizedOptions(
  table: EnumTable,
  resolve: (key: MessageKey) => string,
): { value: string; label: string }[] {
  return table.options.map((option) => ({ value: option.value, label: resolve(option.labelKey) }));
}

/**
 * 枚举字段的选项（value → 已本地化 label）。
 *
 * 查找顺序：本板块 + 本字段 → 同板块其它枚举字段（自建字段 key 是 `custom:*`）→
 * 按当前值反推家族（值在四张表里只属于一个家族时）→ 空数组。
 * `value` 可选：编辑器用它把自建枚举字段的当前值映射回某一家族的完整选项。
 */
export function enumOptionsOf(
  catalog: DocumentFieldCatalog | null | undefined,
  sectionKeyOrProfileKey: string,
  fieldKey: string,
  resolve: (key: MessageKey) => string,
  value?: string,
): { value: string; label: string }[] {
  void catalog;
  const exact = enumTableFor(sectionKeyOrProfileKey, fieldKey);
  if (exact) return localizedOptions(exact, resolve);
  // 自建字段的 key 是 custom:*，目录/fallback 里查不到字段名，只能按板块的特征枚举表兜底。
  const bySection = fieldKey.startsWith("custom:")
    ? enumTableForSection(sectionKeyOrProfileKey)
    : undefined;
  if (bySection) return localizedOptions(bySection, resolve);
  if (value) {
    const entry = ENUM_VALUE_INDEX.get(value);
    const table = entry && entry.tables.length === 1 ? entry.tables[0] : undefined;
    if (table) return localizedOptions(table, resolve);
  }
  return [];
}

/**
 * 枚举字段在 UI 上的显示名（#11a / A5）。
 *
 * 后端 planner 渲染纸面时已把 code 翻成中文（`document_catalog.py` 的 `enum_kind`），
 * 前端 chip / 结构树 / 填入菜单此前一直裸显 `full_time` 这类原始值——这里补上同一层
 * 语义格式化。查找顺序：本板块+本字段 → 同板块枚举字段 → 跨家族唯一值（A5：自建板块 /
 * 新加字段没有目录表可查）→ **回落原值**（绝不返回空串吞掉内容，也不猜有歧义的值）。
 */
export function enumLabelOf(
  catalog: DocumentFieldCatalog | null | undefined,
  sectionKey: string,
  fieldKey: string,
  value: string,
  resolve: (key: MessageKey) => string,
): string {
  if (!value) return value;
  const options = enumOptionsOf(catalog, sectionKey, fieldKey, resolve, value);
  const hit = options.find((option) => option.value === value);
  if (hit) return hit.label;
  const entry = ENUM_VALUE_INDEX.get(value);
  if (entry) {
    const labels = [...entry.labelKeys].map(resolve);
    // 多家族共用同一个值（other / pending / expired…）：只有各家族文案完全一致才敢翻，
    // 否则回退原值——界面上宁可露一次 code，也不能显示错误的状态名。
    if (labels.every((label) => label === labels[0])) return labels[0];
  }
  return value;
}

/**
 * 目录字段在文档里的**实际** format。
 *
 * 自定义字段在目录接口里统一报 `format: "text"`（后端只保证内置字段的纸面格式），但
 * `field_type: "enum"` 的自定义字段在文档里应当按枚举渲染——否则「添加字段」加进来的
 * 枚举字段既没有下拉，值也没法本地化（A5）。
 */
export function effectiveFieldFormat(
  spec: Pick<FieldCatalogField, "field_type" | "format">,
): ItemFormat {
  if (spec.format === "text" && spec.field_type === "enum") return "enum";
  return spec.format;
}

/** item 的 source 构造：资料来源统一从这里出（资料分区键 + 资料字段 id）。 */
export function fieldSourceOf(profileSectionKey: string, fieldId: string | number): FieldSource {
  return { section_key: profileSectionKey, field_id: String(fieldId) };
}

/**
 * 字段目录 → 标签解析器（Q20）。
 *
 * 结构树 / 灰色短字段顺序在 item 没有值、也没有显式 label 时，用目录里的中文标签
 * （GPA→绩效/排名、courses→核心课程…）代替原始英文 key；key 只作为最后的兜底。
 * 返回 undefined 表示"目录里也没有这个字段"，调用方继续退回 key。
 *
 * 同时登记 `key` 与 `profile_section_key`：文档里的 section.key 与资料分区键
 * （educations / experiences…）两套写法都存在，只认一套会让部分板块查不到标签。
 */
export function fieldCatalogLabelResolver(
  catalog: DocumentFieldCatalog | null | undefined,
): (key: string, sectionKey?: string) => string | undefined {
  if (!catalog) return () => undefined;
  const bySection = new Map<string, Map<string, string>>();
  for (const section of catalog.sections) {
    const fields = new Map<string, string>();
    for (const field of section.fields) fields.set(field.key, field.label);
    bySection.set(section.key, fields);
    if (section.profile_section_key && section.profile_section_key !== section.key) {
      bySection.set(section.profile_section_key, fields);
    }
  }
  const headerLabels = new Map<string, string>();
  for (const field of catalog.header_fields) headerLabels.set(field.key, field.label);
  return (key: string, sectionKey?: string) => {
    if (sectionKey) {
      const label = bySection.get(sectionKey)?.get(key);
      if (label) return label;
    }
    return headerLabels.get(key);
  };
}
