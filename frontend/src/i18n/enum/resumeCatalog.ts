// SPDX-License-Identifier: Apache-2.0
/**
 * 简历模板目录（`GET /api/resumes/templates`）里**后端下发的展示名** → 语言包 key。
 *
 * 为什么要有这一层：`section_options` / `format_presets` / `font_scales` 的 `label`
 * 是后端直接下发的**中文展示名**，不是协议值——英文界面下会原样露出中文。协议值本身
 * （分区 `key`、版式 `name`、档位 `name`）是稳定字段，前端按它映射到语言包；
 * 映射不到（后端新增了分区 / 版式 / 档位）时调用方回退后端原文，不丢信息。
 *
 * 只放常量表：不放组件、不在模块作用域求值 `t()`（模块级求值会把首帧语言钉死）。
 */
import type { ResumeFontScale } from "../../types";
import { t } from "../index";
import type { MessageKey } from "../index";

/**
 * 正文分区 key → 界面文案 key（12 个分区，与后端 `DEFAULT_SECTION_ORDER` 对齐）。
 *
 * 全部复用既有 key，不新造中文：七个老分区走编辑器自己的 `editor.section.*`
 * （`summary` 走 `editor.field.summary`），W14 / A4 新增的四个分区在「我的资料」
 * 的分区兜底名里已有同值 key。这些 key 的 zh 值与后端
 * `resume_labels.SECTION_TITLES` 逐字一致，所以替换之后中文渲染结果不变。
 *
 * 注意不要改用 `profileLibrary.sectionFallback.summary`：它的原文是
 * 「个人总结 / 自我评价」，与后端正文分区名「个人总结」不同。
 */
export const RESUME_CATALOG_SECTION_LABEL_KEYS: Record<string, MessageKey> = {
  education: "editor.section.education",
  experience: "editor.section.experience",
  projects: "editor.section.projects",
  publications: "profileLibrary.sectionFallback.publications",
  research_projects: "profileLibrary.sectionFallback.research_projects",
  patents: "profileLibrary.sectionFallback.patents",
  credentials: "profileLibrary.sectionFallback.credentials",
  skills: "editor.section.skills",
  languages: "editor.section.languages",
  campus_experience: "editor.section.campus",
  awards: "editor.section.awards",
  summary: "editor.field.summary",
};

/**
 * 内置版式预设 `name` → 界面文案 key（后端 `FORMAT_PRESETS` 的四个 name）。
 *
 * 用户自制的版式**不查这张表**：后端 `custom_format_options` 里 `label = name`，
 * 那是用户自己输入的名字，翻译它等于改用户数据。
 */
export const RESUME_CATALOG_FORMAT_LABEL_KEYS: Record<string, MessageKey> = {
  standard: "enumsResumeCatalog.formatPreset.standard",
  compact: "enumsResumeCatalog.formatPreset.compact",
  spacious: "enumsResumeCatalog.formatPreset.spacious",
  mono_accent: "enumsResumeCatalog.formatPreset.mono_accent",
};

/** 内置版式预设 `name` → 说明文字 key（后端 `FORMAT_PRESETS[].description` 的稳定 name 映射）。 */
export const RESUME_CATALOG_FORMAT_DESCRIPTION_KEYS: Record<string, MessageKey> = {
  standard: "enumsResumeCatalog.formatPresetDescription.standard",
  compact: "enumsResumeCatalog.formatPresetDescription.compact",
  spacious: "enumsResumeCatalog.formatPresetDescription.spacious",
  mono_accent: "enumsResumeCatalog.formatPresetDescription.mono_accent",
};

/** 字号档位 `name` → 界面文案 key；复用 `resume.fontScale.*`（zh 与后端 `FONT_SCALES` 逐字一致）。 */
export const RESUME_CATALOG_FONT_SCALE_LABEL_KEYS: Record<ResumeFontScale, MessageKey> = {
  small: "resume.fontScale.small",
  standard: "resume.fontScale.standard",
  large: "resume.fontScale.large",
};

/**
 * 内置简历模板 `name` → 界面文案 key（后端 `RESUME_TEMPLATES` 的九个 name）。
 *
 * 三个已下线模板（technical / editorial / split）也要登记：老简历记录里存的就是这三个
 * 名字，重新打开时标题仍要能翻成英文。用户自制模板（`custom === true`）一律不查表。
 */
export const RESUME_CATALOG_TEMPLATE_LABEL_KEYS: Record<string, MessageKey> = {
  classic: "enumsResumeCatalog.template.classic",
  modern: "enumsResumeCatalog.template.modern",
  compact: "enumsResumeCatalog.template.compact",
  elegant: "enumsResumeCatalog.template.elegant",
  technical: "enumsResumeCatalog.template.technical",
  minimal: "enumsResumeCatalog.template.minimal",
  scholar: "enumsResumeCatalog.template.scholar",
  editorial: "enumsResumeCatalog.template.editorial",
  split: "enumsResumeCatalog.template.split",
};

/** 内置简历模板 `name` → 说明文字 key（后端 `RESUME_TEMPLATES[].description` 的稳定 name 映射）。 */
export const RESUME_CATALOG_TEMPLATE_DESCRIPTION_KEYS: Record<string, MessageKey> = {
  classic: "enumsResumeCatalog.templateDescription.classic",
  modern: "enumsResumeCatalog.templateDescription.modern",
  compact: "enumsResumeCatalog.templateDescription.compact",
  elegant: "enumsResumeCatalog.templateDescription.elegant",
  technical: "enumsResumeCatalog.templateDescription.technical",
  minimal: "enumsResumeCatalog.templateDescription.minimal",
  scholar: "enumsResumeCatalog.templateDescription.scholar",
  editorial: "enumsResumeCatalog.templateDescription.editorial",
  split: "enumsResumeCatalog.templateDescription.split",
};

/**
 * 模板的展示名：内置模板走语言包，自制模板回退**后端原文**（那是用户自己输入的名字，
 * 翻译它等于改用户数据）。
 *
 * 这里是函数而不是常量：`t()` 必须在渲染期求值，模块作用域求值会把首帧语言钉死。
 */
export function resumeTemplateLabel(item: {
  name: string;
  label: string;
  custom?: boolean;
}): string {
  const key = item.custom ? undefined : RESUME_CATALOG_TEMPLATE_LABEL_KEYS[item.name];
  return key ? t(key) : item.label;
}

/** 模板说明：与展示名同一套判据（自制模板的说明同样是用户数据）。 */
export function resumeTemplateDescription(item: {
  name: string;
  description: string;
  custom?: boolean;
}): string {
  const key = item.custom ? undefined : RESUME_CATALOG_TEMPLATE_DESCRIPTION_KEYS[item.name];
  return key ? t(key) : item.description;
}

/** 字号档位的展示名：已知档位走语言包，后端新增的未知档位回退原文。 */
export function resumeFontScaleLabel(item: { name: string; label: string }): string {
  const key = RESUME_CATALOG_FONT_SCALE_LABEL_KEYS[item.name as ResumeFontScale];
  return key ? t(key) : item.label;
}
