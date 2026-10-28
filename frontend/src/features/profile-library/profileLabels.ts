// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」的分区名与字段名的**展示文案**。
 *
 * 两类名字都是后端下发的**中文展示名**，协议值是稳定键：
 * - 分区：`section.key`（`educations` / `projects` …）；分区名可改（自建板块本来就是
 *   用户输入），所以只在 `is_builtin` 为真时翻译；
 * - 字段：`field_id`（`<分区>.<键>`，如 `educations.school`）；自建字段的 id 以
 *   `custom:` 开头，名字是用户输入。
 *
 * 映射不到（后端新增了分区/字段）时回退后端原文，不丢信息；也不在模块作用域求值 `t()`。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { getSnapshot } from "../../i18n/localeStore";
// 只用它当"哪些内置字段有文案"的**登记表**：键就是完整的 message key，
// 因此不必再维护一份 id → key 的映射（两份表迟早会不同步）。
import profileFieldPack from "../../i18n/messages/zh-CN.profileField";

/**
 * 源语言：后端下发的字段名/分区名就是中文，中文界面直接用**后端原文**。
 *
 * 这条判断不是省事：它保证中文渲染与后端逐字一致（不依赖语言包那份镜像是否同步），
 * 也让"后端改了字段名、语言包还没跟"只影响英文界面（英文会回退到原文，仍可读）。
 */
const SOURCE_LOCALE = "zh-CN";

/** 内置分区 `key` → 语言包 key（复用 `profileLibrary.sectionFallback.*` 那批文案）。 */
const SECTION_LABEL_KEYS: Record<string, MessageKey> = {
  basic_info: "profileLibrary.sectionFallback.basic_info",
  educations: "profileLibrary.sectionFallback.educations",
  experiences: "profileLibrary.sectionFallback.experiences",
  projects: "profileLibrary.sectionFallback.projects",
  skills: "profileLibrary.sectionFallback.skills",
  campus_experiences: "profileLibrary.sectionFallback.campus_experiences",
  awards: "profileLibrary.sectionFallback.awards",
  summary: "profileLibrary.sectionFallback.summary",
  publications: "profileLibrary.sectionFallback.publications",
  research_projects: "profileLibrary.sectionFallback.research_projects",
  patents: "profileLibrary.sectionFallback.patents",
  credentials: "profileLibrary.sectionFallback.credentials",
  languages: "profileLibrary.sectionFallback.languages",
};

const KNOWN_FIELD_KEYS = new Set(Object.keys(profileFieldPack));

/** 分区展示名：内置分区走语言包，自建/改过名的分区显示后端下发的名字。 */
export function profileSectionLabel(section: {
  key: string;
  name: string;
  is_builtin?: boolean;
}): string {
  if (!section.is_builtin || getSnapshot().locale === SOURCE_LOCALE) return section.name;
  const key = SECTION_LABEL_KEYS[section.key];
  return key ? t(key) : section.name;
}

/** 字段展示名：内置字段按 `field_id` 查表，自建字段显示用户填的名字。 */
export function profileFieldLabel(field: {
  field_id?: string;
  section_key?: string;
  key: string;
  label: string;
  is_builtin?: boolean;
}): string {
  if (getSnapshot().locale === SOURCE_LOCALE) return field.label;
  const id = field.field_id ?? (field.section_key ? `${field.section_key}.${field.key}` : "");
  const key = id ? `profileField.${id}` : "";
  return key && KNOWN_FIELD_KEYS.has(key) ? t(key as MessageKey) : field.label;
}
