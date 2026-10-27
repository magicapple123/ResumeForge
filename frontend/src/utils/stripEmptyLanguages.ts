// SPDX-License-Identifier: Apache-2.0
/**
 * 保存前清理「语言能力」里的**空条目**（2026-10 独立成栏）。
 *
 * 与自建板块 / 科研三栏同一口径：用户在「添加语言能力」后什么都没填就保存时，正文里
 * 会留下一条 `{name: "", level: ""…}`——纸面渲染器会印一行空标签（HTML 的 <li>），
 * 而空列表本来是不序列化的。这里把"画不出来"的条目剔除；字段超长由后端 schema 收口。
 */
import type { ResumeContent, ResumeLanguageEntry } from "../types/resumeContent";

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim() === "";
}

function hasValue(item: ResumeLanguageEntry): boolean {
  return (
    !isBlank(item.name) ||
    !isBlank(item.level) ||
    !isBlank(item.certificate) ||
    !isBlank(item.score) ||
    !isBlank(item.obtained_at)
  );
}

/**
 * 返回清理后的内容（不改入参）；没有可清理的内容时返回**同一个引用**。
 * 整份清空时删掉 `languages` 键（空数组不序列化，与科研三栏一致）。
 */
export function stripEmptyLanguages(content: ResumeContent): ResumeContent {
  const languages = content.languages;
  if (!languages || languages.length === 0) return content;
  const cleaned = languages.filter(hasValue);
  if (cleaned.length === languages.length) return content;
  if (cleaned.length === 0) {
    const rest: ResumeContent = { ...content };
    delete rest.languages;
    return rest;
  }
  return { ...content, languages: cleaned };
}
