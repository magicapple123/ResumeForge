// SPDX-License-Identifier: Apache-2.0
/**
 * 资料字段的「纸面位置」目录（前端唯一读取处）。
 *
 * 后端 GET /profile/field-placement-catalog（0069）返回系统板块字段的默认位置与仅素材标记；
 * 内置字段的 FieldOut 不带纸面位置（由目录决定），自建字段的 FieldOut 自带
 * effective_placement / material_only。资料页的徽标与添加字段的默认值都读这一份，
 * 不在前端复制「type → placement」的映射。
 *
 * 目录是**会话级缓存**（一次请求/会话）：字段定义变更后调用 invalidateFieldPlacementCatalog 重取。
 */
import { useEffect, useState } from "react";
import { request } from "../../api/client";
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";
import type {
  DocumentFieldCatalog,
  FieldCatalogField,
  Placement,
} from "../../types/resumeDocument";
import type { FieldOut, SectionOut } from "./types";

/** 自定义字段可选的纸面位置（文案走结构命名空间，与制作台同一套术语）。 */
export const PROFILE_PLACEMENT_OPTIONS: readonly Placement[] = [
  "title",
  "meta",
  "lead",
  "body",
  "trail",
  "hidden",
];

export const PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  title: "structure.placement.title",
  meta: "structure.placement.meta",
  lead: "structure.placement.lead",
  body: "structure.placement.body",
  trail: "structure.placement.trail",
  hidden: "structure.placement.hidden",
};

/** 位置显示名；未知/空返回「按字段类型自动」。 */
export function profilePlacementLabel(placement: string | null | undefined): string {
  if (!placement) return t("structure.profile.placementAuto");
  const key = PLACEMENT_LABEL_KEYS[placement as Placement];
  return key ? t(key) : placement;
}

/** 仅素材字段恒 hidden（D6）：有效位置读后端计算值，不在这里猜。 */
export function isMaterialOnlyField(field: FieldOut): boolean {
  return field.material_only === true;
}

let cached: DocumentFieldCatalog | null = null;
let inflight: Promise<DocumentFieldCatalog> | null = null;

/** 读字段位置目录（会话级缓存；失败不缓存，下次访问重试）。 */
export function getFieldPlacementCatalog(language = "zh-CN"): Promise<DocumentFieldCatalog> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = request<DocumentFieldCatalog>(
    "/profile/field-placement-catalog?language=" + encodeURIComponent(language),
  )
    .then((catalog) => {
      cached = catalog;
      return catalog;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 字段定义变化（新建 / 删除自定义字段）后丢弃缓存，让下次读取带回新位置。 */
export function invalidateFieldPlacementCatalog(): void {
  cached = null;
}

export interface FieldPlacementCatalogState {
  catalog: DocumentFieldCatalog | null;
  loading: boolean;
  error: boolean;
}

const EMPTY: FieldPlacementCatalogState = { catalog: null, loading: true, error: false };

/** 组件用的目录 hook；目录取不到时加载态结束、error=true，界面退回"无徽标"。 */
export function useFieldPlacementCatalog(): FieldPlacementCatalogState {
  const [state, setState] = useState<FieldPlacementCatalogState>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    void getFieldPlacementCatalog()
      .then((catalog) => {
        if (!cancelled) setState({ catalog, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ catalog: null, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

interface CatalogEntry {
  sectionKey: string;
  field: FieldCatalogField;
}

/** 目录拍平成「资料分区 → 字段」清单：内置字段按 source_field_id 末段与 FieldOut.field_id 对齐。 */
export function catalogFieldsOf(
  catalog: DocumentFieldCatalog | null,
  section: SectionOut | null,
): CatalogEntry[] {
  if (!catalog || !section) return [];
  const entries: CatalogEntry[] = [];
  for (const catalogSection of catalog.sections) {
    if (catalogSection.key !== section.key && catalogSection.profile_section_key !== section.key) {
      continue;
    }
    for (const field of catalogSection.fields)
      entries.push({ sectionKey: catalogSection.key, field });
  }
  return entries;
}

/**
 * 内置字段的目录默认位置（只读徽标）；找不到返回 null。
 *
 * 匹配规则：目录字段的 source_field_id 形如 `educations.education_school`，末段即资料字段
 * 的 field_id；自建字段目录项的 source_field_id 就是 field_id 本身。
 */
export function catalogPlacementOf(
  catalog: DocumentFieldCatalog | null,
  section: SectionOut | null,
  field: FieldOut,
): FieldCatalogField | null {
  const entries = catalogFieldsOf(catalog, section);
  const bySource = entries.find(({ field: candidate }) => {
    const source = candidate.source_field_id ?? "";
    const tail = source.includes(".") ? source.slice(source.lastIndexOf(".") + 1) : source;
    return tail === field.field_id || candidate.key === field.key;
  });
  return bySource?.field ?? null;
}
