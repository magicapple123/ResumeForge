// SPDX-License-Identifier: Apache-2.0
/**
 * 保存前清理自建板块里的**空条目**（F10）。
 *
 * 为什么需要：方案里定义、正文里还没有的自建板块会显示一个"添加条目"骨架入口
 * （CustomSectionsEditor）；用户点了却什么都没填就保存，正文里会出现一条
 * `{text: "", lines: []}`——后端 `ResumeCustomEntry.text_or_lines_required` 会 422
 * （「自建条目至少需要正文或一行字段」），保存被拦。这里把这种"画不出来"的条目剔除，
 * 与科研三栏的 `stripEmptyResearch`（空数组不序列化）同一口径。
 *
 * 同一条目里标签为空的行也剔除：后端 `ResumeCustomLine.label` 必填，编辑器虽有必填校验，
 * 但历史/外部写入的脏数据不该让整份保存失败。
 */
import type { ResumeContent, ResumeCustomSection } from "../types";

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim() === "";
}

/**
 * 返回清理后的内容（不改入参）；没有可清理的内容时返回**同一个引用**，避免无谓的重渲染。
 *
 * 整份自建板块被清空时删掉 `custom_sections` 键（空列表不序列化，与科研三栏一致）。
 */
export function stripEmptyCustomSections(content: ResumeContent): ResumeContent {
  const sections = content.custom_sections;
  if (!sections || sections.length === 0) return content;
  let touched = false;
  const cleaned: ResumeCustomSection[] = [];
  for (const section of sections) {
    const entries = [];
    for (const entry of section.entries ?? []) {
      const lines = (entry.lines ?? []).filter((line) => !isBlank(line.label));
      if (
        lines.length !== (entry.lines ?? []).length ||
        (isBlank(entry.text) && lines.length === 0)
      ) {
        touched = true;
      }
      if (isBlank(entry.text) && lines.length === 0) continue;
      entries.push(lines.length === (entry.lines ?? []).length ? entry : { ...entry, lines });
    }
    if (entries.length === 0) {
      touched = true;
      continue;
    }
    cleaned.push(
      entries.length === (section.entries ?? []).length ? section : { ...section, entries },
    );
  }
  if (!touched) return content;
  if (cleaned.length === 0) {
    const rest: ResumeContent = { ...content };
    delete rest.custom_sections;
    return rest;
  }
  return { ...content, custom_sections: cleaned };
}
