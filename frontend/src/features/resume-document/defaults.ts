// SPDX-License-Identifier: Apache-2.0
/**
 * v2 文档的默认值工厂（纯函数）。
 *
 * 所有"新建一条"的入口都从这里取值，与后端 schema 的默认值逐字段一致：两处各写一份，
 * 字段改了就会分叉（保存时的 normalize / 渲染时的 planner 都会按后端默认值走）。
 *
 * `show_label` 的默认值按位置决定：lead/trail 是「标签：值」的灰色短字段，默认显示标签；
 * title/meta/body 默认不显示（头部本来就短，正文块由段落语义承担）。
 */
import type {
  AuthorsItem,
  BodyStyle,
  DocumentFieldCatalog,
  EntryLayout,
  FieldCatalogField,
  FieldItem,
  FieldSource,
  HeaderCatalogField,
  HeaderItem,
  HeaderPlacement,
  ItemFormat,
  ItemJoin,
  Placement,
  ResumeAuthor,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeLanguageCode,
  ResumeSection,
  SectionKind,
  SectionLayout,
  TextItem,
} from "../../types/resumeDocument";
import { newObjectId } from "./identity";

export function defaultSectionLayout(): SectionLayout {
  return {
    columns: 1,
    align: "equal",
    gap: null,
    hide_title: false,
    keep_together: false,
    start_on_new_page: false,
    title_override: "",
  };
}

export function defaultEntryLayout(): EntryLayout {
  return {
    head: "split",
    columns: null,
    align: null,
    gap: null,
    // 条目级分页默认关闭：与后端 schema 的 False 默认值一致（分区级另有开关）。
    start_on_new_page: false,
    keep_together: false,
  };
}

export function emptyEntry(id: string | null = null): ResumeEntry {
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: defaultEntryLayout(),
    items: [],
  };
}

export function emptySection(
  key: string,
  kind: SectionKind = "entries",
  title = "",
): ResumeSection {
  return { key, title, kind, layout: defaultSectionLayout(), entries: [] };
}

/** 空文档：新简历的真实内容由后端投影/生成；这里只给前端夹具与"从零开始"用。 */
export function emptyDocument(language: ResumeLanguageCode = "zh-CN"): ResumeDocument {
  return {
    version: 2,
    language,
    header: { items: [], contact_breaks: [] },
    sections: [],
  };
}

/** 灰色短字段默认显示标签：lead / trail。 */
export function defaultShowLabel(placement: Placement): boolean {
  return placement === "lead" || placement === "trail";
}

export function defaultTextItem(text = "", style: BodyStyle = "bullet"): TextItem {
  return { kind: "text", id: newObjectId(), style, text, hidden: false };
}

export interface FieldItemInit {
  key: string;
  value?: string;
  label?: string;
  placement?: Placement;
  format?: ItemFormat;
  wrap?: "none" | "paren";
  show_label?: boolean;
  solo?: boolean;
  source?: FieldSource | null;
  body_style?: BodyStyle;
  id?: string;
}

export function defaultFieldItem(init: FieldItemInit): FieldItem {
  const placement = init.placement ?? "trail";
  return {
    kind: "field",
    id: init.id ?? newObjectId(),
    key: init.key,
    label: init.label ?? "",
    value: init.value ?? "",
    placement,
    format: init.format ?? "text",
    wrap: init.wrap ?? "none",
    show_label: init.show_label ?? defaultShowLabel(placement),
    solo: init.solo ?? false,
    source: init.source ?? null,
    body_style: init.body_style ?? "bullet",
  };
}

export interface ListItemInit {
  key: string;
  values?: string[];
  label?: string;
  placement?: Placement;
  join?: ItemJoin;
  show_label?: boolean;
  solo?: boolean;
  body_style?: BodyStyle;
  id?: string;
}

export function defaultListItem(init: ListItemInit): ResumeItem {
  const placement = init.placement ?? "trail";
  return {
    kind: "list",
    id: init.id ?? newObjectId(),
    key: init.key,
    label: init.label ?? "",
    values: init.values ?? [],
    placement,
    join: init.join ?? "semicolon",
    show_label: init.show_label ?? defaultShowLabel(placement),
    solo: init.solo ?? false,
    body_style: init.body_style ?? "bullet",
  };
}

export function emptyAuthor(): ResumeAuthor {
  return { name: "", is_self: false, corresponding: false };
}

export interface AuthorsItemInit {
  key: string;
  authors?: ResumeAuthor[];
  label?: string;
  placement?: Placement;
  show_label?: boolean;
  id?: string;
}

export function defaultAuthorsItem(init: AuthorsItemInit): AuthorsItem {
  const placement = init.placement ?? "trail";
  return {
    kind: "authors",
    id: init.id ?? newObjectId(),
    key: init.key,
    label: init.label ?? "",
    authors: init.authors ?? [],
    placement,
    show_label: init.show_label ?? false,
    solo: false,
  };
}

export interface HeaderItemInit {
  key: string;
  value?: string;
  label?: string;
  placement?: HeaderPlacement;
  format?: ItemFormat;
  id?: string;
}

export function defaultHeaderItem(init: HeaderItemInit): HeaderItem {
  return {
    kind: "field",
    id: init.id ?? newObjectId(),
    key: init.key,
    label: init.label ?? "",
    value: init.value ?? "",
    placement: init.placement ?? "contact",
    format: init.format ?? "text",
  };
}

/** 目录字段（后端下发或 fallback）→ 默认 item（位置/格式/标签都按目录走）。 */
export function fieldItemFromCatalog(spec: FieldCatalogField): FieldItem {
  const placement = spec.material_only ? "hidden" : spec.default_placement;
  return defaultFieldItem({
    key: spec.key,
    label: "",
    placement,
    format: spec.format,
    source: { section_key: "", field_id: spec.source_field_id } as FieldSource,
  });
}

/** 页眉目录字段 → 默认页眉 item。 */
export function headerItemFromCatalog(spec: HeaderCatalogField): HeaderItem {
  return defaultHeaderItem({
    key: spec.key,
    placement: spec.placement,
    format: spec.format,
  });
}

/** 目录里的字段在文档里是否已经存在（同 key 的 field/list/authors 都算）。 */
export function documentHasFieldKey(
  document: Pick<ResumeDocument, "sections" | "header">,
  key: string,
): boolean {
  if (document.header.items.some((item) => item.key === key)) return true;
  return document.sections.some((section) =>
    section.entries.some((entry) =>
      entry.items.some((item) => item.kind !== "text" && item.key === key),
    ),
  );
}

/** 只给类型用：避免 `DocumentFieldCatalog` 在本文件里被 lint 当成未使用。 */
export type CatalogInput = DocumentFieldCatalog | null | undefined;
