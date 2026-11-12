// SPDX-License-Identifier: Apache-2.0
/**
 * 双语对照的标签解析（从 BilingualWorkspaceV2 拆出守 500 行预算）。
 * 目录优先（与制作台其它面板同一份字段目录），缺省按 item 类型给通用名。
 */
import { bt } from "./i18n";
import { catalogSectionOf } from "../document";
import { isCustomKey, isCustomSection } from "./fieldPairs";
import type { PairLabels } from "./fieldPairs";
import type { DocumentFieldCatalog } from "../../../types/resumeDocument";

export function buildPairLabels(catalog: DocumentFieldCatalog | null): PairLabels {
  return {
    item: (sectionKey, item) => {
      if ("label" in item && item.label) return item.label;
      const key = "key" in item ? item.key : "";
      if (sectionKey === "header") {
        const header = catalog?.header_fields.find((field) => field.key === key);
        return header?.label ?? (key || bt("bilingual.field.body"));
      }
      const field = catalogSectionOf(catalog, sectionKey)?.fields.find(
        (candidate) => candidate.key === key,
      );
      if (field) return field.label;
      if (item.kind === "text") return bt("bilingual.field.body");
      if (item.kind === "list") return bt("bilingual.field.list");
      if (item.kind === "authors") return bt("bilingual.field.authors");
      return isCustomKey(key) ? bt("bilingual.field.custom") : key;
    },
    group: (sectionKey, sectionTitle) => {
      if (sectionKey === "header") return bt("bilingual.compare.group.header");
      if (sectionTitle) return sectionTitle;
      const section = catalogSectionOf(catalog, sectionKey);
      if (section) return section.title;
      return isCustomSection(sectionKey) ? bt("bilingual.compare.group.custom") : sectionKey;
    },
  };
}
