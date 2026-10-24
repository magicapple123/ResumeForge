// SPDX-License-Identifier: Apache-2.0
/**
 * W16 真实 API 响应 → 既有界面模型的**纯映射**（不 import React、不做请求）。
 *
 * ## 为什么 diff 不是逐字段
 *
 * 后端 `ResumeDiffOut` 是**按行**的三态差异（整份文档顺序），没有 path；而采纳接口是
 * 按 path 一次写多个字段。所以候选列表由「原文 vs 候选内容」自己按字段比出来：
 * 路径集合复用 `fieldPairs.buildBilingualPairs`（与对照视图同一份字段表），
 * 被事实锁/术语锁定保留原文的路径由 `blocked_fields` 标记为不可采纳。
 */
import { buildBilingualPairs } from "./fieldPairs";
import type {
  BilingualPair,
  GlossaryCategory,
  GlossaryTerm,
  LanguageVariant,
  TranslationCandidate,
} from "./types";
import type { VariantDetailOut, GlossaryTermIn } from "./api";

/** 变体 brief → 界面模型（模板/页数从 render_context 兜底）。 */
export function variantToLanguageVariant(
  variant: VariantDetailOut | LanguageVariant,
): LanguageVariant {
  const context = (variant as VariantDetailOut).render_context ?? {};
  return {
    id: variant.id,
    resume_id: variant.resume_id,
    name: variant.name,
    language: variant.language,
    variant_group_id: variant.variant_group_id,
    template: String(context.template ?? (variant as LanguageVariant).template ?? ""),
    page_limit: Number(context.page_limit ?? (variant as LanguageVariant).page_limit ?? 1),
    font_scale: String(context.font_scale ?? (variant as LanguageVariant).font_scale ?? ""),
    created_at: String(variant.created_at ?? ""),
    updated_at: variant.updated_at ?? undefined,
  };
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
): GlossaryTermIn {
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

/** 单行文本的展示用 token：整段替换（不另写词级 diff，避免第二套高亮口径）。 */
export function displayTokens(before: string, after: string): TranslationCandidate["tokens"] {
  if (!before) return [{ type: "added", text: after }];
  if (!after || before === after) return [{ type: "unchanged", text: before || after }];
  return [
    { type: "removed", text: before },
    { type: "added", text: after },
  ];
}

/** 字段标签：从对照行里借 labelKey（同一份字段表，避免两处维护）。 */
function labelFor(path: string): string {
  const pair = buildBilingualPairs(null, null).find((item) => item.path === path);
  return pair ? pair.labelKey : "bilingual.field.summary";
}

/**
 * 原文内容 + 翻译候选内容 → 逐字段候选（只列真变了的路径）。
 *
 * `blockedPaths` 来自后端 `blocked_fields`：这些路径保留原文，界面上不可勾选采纳。
 */
export function buildTranslationCandidates(
  original: Record<string, unknown> | null,
  candidate: Record<string, unknown> | null,
  blockedPaths: readonly string[],
): TranslationCandidate[] {
  const blocked = new Set(blockedPaths);
  const pairs = buildBilingualPairs(original as never, candidate as never).filter(
    (pair: BilingualPair) => pair.status === "changed",
  );
  return pairs.map((pair) => ({
    path: pair.path,
    labelKey: labelFor(pair.path),
    before: pair.primary,
    after: pair.secondary,
    tokens: displayTokens(pair.primary, pair.secondary),
    blocked: blocked.has(pair.path) || pair.locked,
  }));
}

/** 采纳时提交给后端的 items：只取选中的路径与候选文本。 */
export function adoptItems(
  candidates: readonly TranslationCandidate[],
  paths: readonly string[],
): { path: string; text: string }[] {
  const wanted = new Set(paths);
  return candidates
    .filter((candidate) => wanted.has(candidate.path) && !candidate.blocked && candidate.after)
    .map((candidate) => ({ path: candidate.path, text: candidate.after }));
}

/**
 * 「撤销采纳」的 items：用采纳前的旧文本再采纳一次。
 *
 * 为什么不是新接口：adopt 只改列出的路径，把旧值写回去就是精确回退；
 * 后端保证任一项失败整批不落，所以回退要么全成要么原文不动。
 */
export function undoItems(
  candidates: readonly TranslationCandidate[],
  appliedPaths: readonly string[],
): { path: string; text: string }[] {
  const applied = new Set(appliedPaths);
  return candidates
    .filter((candidate) => applied.has(candidate.path) && candidate.before)
    .map((candidate) => ({ path: candidate.path, text: candidate.before }));
}

/** translate 响应的源语言/目标语言校验（前端提前拦住"同语言翻译"）。 */
export function sameLanguage(source: string, target: "zh-CN" | "en-US"): boolean {
  return source === target;
}
