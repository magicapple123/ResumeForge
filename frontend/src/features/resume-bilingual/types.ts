// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本（W16 / D07、D15）的前端类型，**v2 文档模型**口径。
 *
 * 与 v1 的差别：字段对照/翻译候选不再按"分区数组 + 字段名"定位，而是按
 * `ResumeDocument` 的 item 路径（`header.{itemId}` / `{sectionKey}.{entryId}.{itemId}`）定位。
 * 路径格式与后端 `read_document_path/write_document_path` 的 v2 item path 一致，
 * 采纳接口可以直接按同一串路径写回变体文档。
 *
 * 语言版本本身就是 W13 的"变体（variant）"+ 两个 W16 列（`language` / `variant_group_id`）；
 * 这里不重复定义"变体"概念。
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

/** 一行字段对照（v2 item 粒度）。 */
export interface BilingualPair {
  /** 稳定行 id = v2 item 路径（同一份文档里唯一）。 */
  id: string;
  /** 所属分组：`header` 或 section.key（含 `custom:<uuid>`）。 */
  sectionKey: string;
  /** 分组显示名（组件按目录/板块标题解析后传入）。 */
  groupLabel: string;
  /** v2 item 路径：`header.{itemId}` / `{sectionKey}.{entryId}.{itemId}`。 */
  path: string;
  /** 字段显示名（item.label 或目录标签）。 */
  label: string;
  /** 双列文本（列表/作者按分隔符连接；任一侧缺失为空串）。 */
  primary: string;
  secondary: string;
  /** 一致性状态：一致 / 有差异 / 两边都空。 */
  status: "same" | "changed" | "empty";
  /** 该 item 能否逐项采纳：只有字段与文本块可以；列表/作者/自建字段只读展示。 */
  adoptable: boolean;
  /** 事实锁/术语锁定（后端 blocked_fields 或本地身份字段规则）：不可勾选采纳。 */
  locked: boolean;
}

/** 翻译候选中的一条（`POST .../translate` 的候选 → 逐项采纳的输入）。 */
export interface TranslationCandidate {
  /** v2 item 路径（采纳接口原样接收）。 */
  path: string;
  label: string;
  before: string;
  after: string;
  /** 行内三态（复用 `types/resumeWriting` 的 DiffToken 形状）。 */
  tokens: { type: "added" | "removed" | "unchanged"; text: string }[];
  /** 事实锁命中的字段：不能采纳，界面上禁用勾选并给出原因。 */
  blocked: boolean;
}

/** 一致性检查结果（D07/D15）。 */
export interface BilingualHint {
  id: string;
  kind: "date_format" | "punctuation" | "spacing" | "long_url";
  path: string;
  /** 字段显示名（与 `BilingualPair.label` 同一份）。 */
  label: string;
}
