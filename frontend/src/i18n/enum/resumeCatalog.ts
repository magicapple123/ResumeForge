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
