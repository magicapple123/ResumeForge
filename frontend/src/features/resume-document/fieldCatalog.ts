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

/** 枚举字段的选项（value → 已本地化 label）；目录/fallback 都没有时返回空数组。 */
export function enumOptionsOf(
  catalog: DocumentFieldCatalog | null | undefined,
  sectionKeyOrProfileKey: string,
  fieldKey: string,
  resolve: (key: MessageKey) => string,
): { value: string; label: string }[] {
  void catalog;
  const fallback = FALLBACK_SECTIONS.find(
    (section) =>
      section.key === sectionKeyOrProfileKey ||
      section.profileSectionKey === sectionKeyOrProfileKey,
  )?.fields.find((field) => field.key === fieldKey);
  if (!fallback?.enumOptions) return [];
  return fallback.enumOptions.map((option) => ({
    value: option.value,
    label: resolve(option.labelKey),
  }));
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
