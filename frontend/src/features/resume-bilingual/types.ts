// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本（W16 / D07、D15）的前端类型，与 Wave3 契约 §2.2 对齐。
 *
 * ## 与 W13 的关系
 *
 * 语言版本就是 W13 的"变体（variant）"加上两个 W16 列（`language` / `variant_group_id`）。
 * 前端不重复定义"变体"概念：一个变体 = 一份内容 + 一份排版上下文；W16 只是**按语言**使用它。
 * 后端表未落地前，本文件是组件与测试的唯一来源。
 */

/** 简历语言标签（与后端 `resume_labels` 支持的语言一致）。 */
export type ResumeLanguageTag = "zh-CN" | "en-US";

export const RESUME_LANGUAGE_TAGS: readonly ResumeLanguageTag[] = ["zh-CN", "en-US"];

/** 一个语言版本（W13 变体 + W16 语言标签）。 */
export interface LanguageVariant {
  id: number;
  resume_id: number;
  /** 用户可见的名字（如"中文版-投递用"）。 */
  name: string;
  /** 语言标签；空串 = 未标注（旧变体）。 */
  language: ResumeLanguageTag | "";
  /** 同一份简历的多语言版本分组（母版变体 id）；null = 独立变体。 */
  variant_group_id: number | null;
  /** 该版本自己的排版（W13 render_context 的展示摘要，互不影响）。 */
  template: string;
  page_limit: number;
  font_scale: string;
  created_at: string;
  updated_at?: string;
}

/** 术语表类别（与后端白名单一致）。 */
export type GlossaryCategory = "name" | "institution" | "company" | "skill" | "term";

export const GLOSSARY_CATEGORIES: readonly GlossaryCategory[] = [
  "name",
  "institution",
  "company",
  "skill",
  "term",
];

/** 数据集级术语表条目。 */
export interface GlossaryTerm {
  id: number;
  source_term: string;
  target_term: string;
  language_from: string;
  language_to: string;
  category: GlossaryCategory;
  /** 锁定后：翻译结果必须逐字包含 target_term（服务端校验）。 */
  locked: boolean;
  note: string;
}

/** 字段对照的分组键（用于两列并排的分组标题）。 */
export type BilingualGroup =
  "header" | "summary" | "education" | "experience" | "projects" | "skills" | "awards" | "campus";

/** 一行字段对照。 */
export interface BilingualPair {
  /** 稳定行 id：`group:index:field`（用于勾选与复检比对）。 */
  id: string;
  group: BilingualGroup;
  /** 字段路径（与 data-resume-path 同写法，如 `experience.0.company`）。 */
  path: string;
  /** 字段标签对应的文案 key（i18n）。 */
  labelKey: string;
  /** 双列文本（多行字段用换行连接；任一侧缺失为空串）。 */
  primary: string;
  secondary: string;
  /** 是否受事实锁保护（姓名/机构/时间/数字/职责边界）。 */
  locked: boolean;
  /** 一致性状态：一致 / 有差异 / 两边都空。 */
  status: "same" | "changed" | "empty";
}

/** 翻译候选中的一条（后端 translate 接口的 items 元素）。 */
export interface TranslationCandidate {
  path: string;
  labelKey: string;
  before: string;
  after: string;
  /** 行内词级三态（复用 `types/resumeWriting` 的 DiffToken 形状）。 */
  tokens: { type: "added" | "removed" | "unchanged"; text: string }[];
  /** 事实锁命中的字段：不能采纳，界面上禁用勾选并给出原因。 */
  blocked: boolean;
}

/** 一致性检查结果（D07/D15）。 */
export interface BilingualHint {
  id: string;
  kind: "date_format" | "punctuation" | "spacing" | "long_url";
  path: string;
  /** 字段标签的文案 key（与 `BilingualPair.labelKey` 同一份）。 */
  labelKey: string;
}
