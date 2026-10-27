// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库 / 资料箱内置分类的「协议值 → 语言包 key」映射。
 *
 * 协议值仍是 `types/knowledge.ts` 的 `KNOWLEDGE_CATEGORIES` 与 `types/material.ts` 的
 * `MATERIAL_CATEGORIES`：它们会提交给后端，也是筛选与分组的键，**永远不翻**（两个 types
 * 文件一个字都没改）。这里只加一层展示名——渲染时把 label 换成 `t(key)`；用户自建分类
 * 是后端返回的自由字符串，查不到就回退成原值，不丢信息。
 *
 * 模块作用域不能求值 `t()`（切语言不会重渲染），所以本文件只放 key 表与查表函数，
 * 真正翻译发生在 `knowledgeCategoryLabel()` / `materialCategoryLabel()` 被调用时。
 */
import { t, type MessageKey } from "../../i18n";
import { KNOWLEDGE_CATEGORIES, MATERIAL_CATEGORIES } from "../../types";

/** 知识库分类的协议值联合（由 types 表的 `as const` 推导，不另写一份清单）。 */
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];
/** 资料箱分类的协议值联合（同上）。 */
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/** 知识库内置分类：`KNOWLEDGE_CATEGORIES` 的协议值一个不少。 */
export const KNOWLEDGE_CATEGORY_LABEL_KEYS: Record<KnowledgeCategory, MessageKey> = {
  面经: "enumsKnowledge.category.knowledge.interviewNotes", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  简历技巧: "enumsKnowledge.category.knowledge.resumeTips",
  求职策略: "enumsKnowledge.category.knowledge.jobSearchStrategy", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  面试问答: "enumsKnowledge.category.knowledge.interviewQa",
  公司信息: "enumsKnowledge.category.knowledge.companyResearch", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  行业知识: "enumsKnowledge.category.knowledge.industryKnowledge",
  其他: "enumsKnowledge.category.knowledge.other", // i18n-ok: 后端协议值（中文枚举），仅作查表键
};

/** 资料箱内置分类：`MATERIAL_CATEGORIES` 的协议值一个不少。 */
export const MATERIAL_CATEGORY_LABEL_KEYS: Record<MaterialCategory, MessageKey> = {
  证书: "enumsKnowledge.category.material.certificates", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  作品: "enumsKnowledge.category.material.workSamples",
  链接: "enumsKnowledge.category.material.links", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  笔记: "enumsKnowledge.category.material.notes",
  实习材料: "enumsKnowledge.category.material.internshipDocuments", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  校园材料: "enumsKnowledge.category.material.campusDocuments",
  其他: "enumsKnowledge.category.material.other", // i18n-ok: 后端协议值（中文枚举），仅作查表键
};

/**
 * 只认自己的键：原型链上的 `constructor` / `__proto__` 不能变成显示名
 * （与 `claimPresentation.ownColor` 同一条防御）。
 */
function lookup<K extends string>(
  labels: Record<K, MessageKey>,
  value: string,
): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value as K] : undefined;
}

/** 未知取值返回 `undefined`，调用方回退成原值（用户自建分类不丢）。 */
export function knowledgeCategoryLabelKey(value: string): MessageKey | undefined {
  return lookup(KNOWLEDGE_CATEGORY_LABEL_KEYS, value);
}

/** 同上，资料箱分类。 */
export function materialCategoryLabelKey(value: string): MessageKey | undefined {
  return lookup(MATERIAL_CATEGORY_LABEL_KEYS, value);
}

/** 展示名：内置分类走语言包，用户自建分类原样返回。 */
export function knowledgeCategoryLabel(value: string): string {
  const key = knowledgeCategoryLabelKey(value);
  return key ? t(key) : value;
}

/** 同上，资料箱分类。 */
export function materialCategoryLabel(value: string): string {
  const key = materialCategoryLabelKey(value);
  return key ? t(key) : value;
}
