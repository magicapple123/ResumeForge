// SPDX-License-Identifier: Apache-2.0
/**
 * W16 真实 API 响应 → 界面模型的**纯映射**（不 import React、不做请求）。
 *
 * v2 口径：变体的 `content` 已是 `ResumeDocument`，候选文档与正文同构、按 item 路径
 * 逐项采纳；这里只负责"接口形状 → 界面形状"的收口与术语表映射，不再处理 v1 分区数组。
 */
import type { ResumeDocument } from "../../types/resumeDocument";
import type { VariantBriefOut, VariantDetailOut } from "./api";
import type { GlossaryCategory, GlossaryTerm, LanguageVariant } from "./types";

/** 变体 brief/detail → 界面模型（语言版本切换条只关心 id/名字/语言标签）。 */
export function variantToLanguageVariant(
  variant: VariantBriefOut | VariantDetailOut,
): LanguageVariant {
  return {
    id: variant.id,
    resume_id: variant.resume_id,
    name: variant.name,
    language: variant.language,
    variant_group_id: variant.variant_group_id,
    created_at: String(variant.created_at ?? ""),
    updated_at: variant.updated_at ?? undefined,
  };
}

/** 变体详情里的正文（后端已收口为 v2；异常数据按 null 处理，不编造结构）。 */
export function variantDocumentOf(
  variant: Pick<VariantDetailOut, "content"> | null | undefined,
): ResumeDocument | null {
  const content = variant?.content;
  if (!content || typeof content !== "object") return null;
  return (content as ResumeDocument).version === 2 ? (content as ResumeDocument) : null;
}

/** 术语响应 → 界面模型（category 收窄到白名单，未知按 term）。 */
const CATEGORY_SET = new Set<GlossaryCategory>(["name", "institution", "company", "skill", "term"]);

export function glossaryOutToTerm(term: GlossaryTerm): GlossaryTerm {
  const category = CATEGORY_SET.has(term.category as GlossaryCategory)
    ? (term.category as GlossaryCategory)
    : "term";
  return { ...term, category };
}

/** 界面术语 → 新建请求（补语言对：源语言 = 当前简历语言，目标 = 对侧）。 */
export function termToCreatePayload(
  term: GlossaryTerm,
  languageFrom: "zh-CN" | "en-US",
  languageTo: "zh-CN" | "en-US",
): {
  source_term: string;
  target_term: string;
  language_from: "zh-CN" | "en-US";
  language_to: "zh-CN" | "en-US";
  category: GlossaryCategory;
  locked: boolean;
  note: string;
} {
  return {
    source_term: term.source_term,
    target_term: term.target_term,
    language_from: languageFrom,
    language_to: languageTo,
    category: term.category,
    locked: term.locked,
    note: term.note,
  };
}

/**
 * 两份文档是否**逐字节相同**（键顺序敏感）。
 *
 * 用途：新建语言版本的流程是「先把正文整份复制过来，再翻译」。翻译没跑成/没跑过时
 * 变体的 content 就是当前简历的原样副本，对照视图两列一字不差——用户会以为功能坏了。
 * 界面据此显示"还没翻译"的提示条。
 */
export function isSameContent(a: unknown, b: unknown): boolean {
  const empty = (value: unknown) =>
    value === null ||
    value === undefined ||
    (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0);
  if (empty(a) || empty(b)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** translate 响应的源语言/目标语言校验（前端提前拦住"同语言翻译"）。 */
export function sameLanguage(source: string, target: "zh-CN" | "en-US"): boolean {
  return source === target;
}
