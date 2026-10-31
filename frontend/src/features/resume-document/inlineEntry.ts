// SPDX-License-Identifier: Apache-2.0
/**
 * 行内板块（技能 / 语言）"新建一条"的默认值（Q06）。
 *
 * 行内板块在 v2 里是"每条 entry 一行"，v1 的每个技能 / 每种语言各转成一条 entry
 * （后端 `document_converter.py`）。用户点「＋ 添加技能 / 添加语言」时也要照这个形状建：
 * 一条 entry + 目录里该板块的默认字段槽（技能 = 名称 / 级别 / 技能分类；语言 = 名称 /
 * 级别 / 取得时间…）。空 entry 加进去在纸面上是一行空白，用户根本不知道要改什么。
 *
 * 与「添加字段」菜单共用同一份字段目录：目录缺省（接口失败 / 单测无目录）时给空 entry，
 * 用户仍能用行内「添加字段」逐项补——**不能凭空编字段**，那会让保存时的 normalize 漂移。
 */
import type { DocumentFieldCatalog, ResumeEntry, ResumeSection } from "../../types/resumeDocument";
import { emptyEntry } from "./defaults";
import { catalogFieldsOf, catalogSectionOf } from "./fieldCatalog";
import { defaultFieldItem } from "./defaults";

export function defaultInlineEntry(
  catalog: DocumentFieldCatalog | null | undefined,
  section: ResumeSection,
): ResumeEntry {
  const base = emptyEntry();
  const catalogSection = catalogSectionOf(catalog, section.key);
  const items = catalogFieldsOf(catalog, section.key)
    // 仅素材字段默认落在 hidden 里；新建一行时先不加，避免行内出现看不见的字段。
    .filter((field) => !field.material_only)
    .map((field) =>
      defaultFieldItem({
        key: field.key,
        placement: field.default_placement,
        format: field.format,
        source:
          catalogSection?.profile_section_key && field.source_field_id
            ? { section_key: catalogSection.profile_section_key, field_id: field.source_field_id }
            : null,
      }),
    );
  return { ...base, items };
}
