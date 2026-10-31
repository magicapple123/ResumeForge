// SPDX-License-Identifier: Apache-2.0
/** 系统板块 key → 语言包标签；自建板块用文档里的 title，两者都取不到时用兜底文案。 */
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";

export const SECTION_LABEL_KEYS: Record<string, MessageKey> = {
  education: "structure.section.education",
  experience: "structure.section.experience",
  projects: "structure.section.projects",
  campus_experience: "structure.section.campus_experience",
  awards: "structure.section.awards",
  publications: "structure.section.publications",
  research_projects: "structure.section.research_projects",
  patents: "structure.section.patents",
  credentials: "structure.section.credentials",
  skills: "structure.section.skills",
  languages: "structure.section.languages",
  summary: "structure.section.summary",
  personal: "structure.section.personal",
};

/**
 * 系统板块 key 的显示名：语言包正名优先，未知 key / 自建板块用调用方给的兜底标题
 * （自建板块的 title 在文档里，不会在语言包里出现）。
 *
 * 这是结构树、条目字段排版、分页面板共用的**唯一**映射入口：三处各写一份
 * `SECTION_LABEL_KEYS` 曾在 Q10 里出现名不一致（「实习与工作」vs「实习/工作经历」）。
 */
export function sectionKeyLabel(key: string, fallback = ""): string {
  const messageKey = SECTION_LABEL_KEYS[key];
  if (messageKey) return t(messageKey);
  return fallback.trim() || t("structure.section.untitled");
}

/** 板块显示名：自建板块 title 优先，系统板块走语言包，未知 key 用「自建板块」兜底。 */
export function sectionDisplayLabel(section: {
  key: string;
  title?: string;
  layout?: { title_override?: string };
}): string {
  const override = section.layout?.title_override?.trim();
  if (override) return override;
  const title = section.title?.trim();
  if (title) return title;
  return sectionKeyLabel(section.key);
}
