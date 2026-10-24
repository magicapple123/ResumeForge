// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本（W16-BE，迁移 0058）的真实 API 出口。
 *
 * 接口口径（对照 wave3 §2 + lead 批准的偏差）：
 * - 翻译候选 `POST /{id}/variants/{vid}/translate` **不落库**，只回候选与 blocked_fields；
 * - 逐项采纳 `POST .../adopt` 的写入目标是**该语言变体**（返回 `VariantDetailOut`），
 *   不覆盖当前语言正文——所以「撤销采纳」= 用旧值再采纳一次（正文任何时刻都可回退）；
 * - 术语软删进回收站第 18 类（`glossary_term`），恢复走既有 `restoreTrashItem`。
 */
import { request } from "../../api/client";
import type { GlossaryTerm, LanguageVariant, TranslationCandidate } from "./types";

export interface VariantListOut {
  items: LanguageVariant[];
}
export interface VariantDetailOut extends LanguageVariant {
  content: Record<string, unknown>;
  render_context?: Record<string, unknown>;
}
export interface TranslateVariantOut {
  variant_id: number;
  source_language: string;
  target_language: string;
  candidate: Record<string, unknown>;
  glossary_hits: { source: string; target: string }[];
  blocked_fields: string[];
}
export interface AdoptTranslationOut {
  variant: VariantDetailOut;
  applied_paths: string[];
  content_sha256: string;
}
export interface TranslateVariantPayload {
  target_language: "zh-CN" | "en-US";
  glossary_locked_only?: boolean;
}
export interface GlossaryTermIn {
  source_term: string;
  target_term: string;
  language_from: "zh-CN" | "en-US";
  language_to: "zh-CN" | "en-US";
  category: GlossaryTerm["category"];
  locked: boolean;
  note: string;
}
export type GlossaryTermUpdate = Partial<Omit<GlossaryTermIn, "language_from" | "language_to">>;

const variantBase = (resumeId: number) => "/resumes/" + resumeId + "/variants";

export function listVariants(resumeId: number): Promise<VariantListOut> {
  return request(variantBase(resumeId));
}

export function getVariant(resumeId: number, variantId: number): Promise<VariantDetailOut> {
  return request(variantBase(resumeId) + "/" + variantId);
}

export function translateVariant(
  resumeId: number,
  variantId: number,
  payload: TranslateVariantPayload,
): Promise<TranslateVariantOut> {
  return request(variantBase(resumeId) + "/" + variantId + "/translate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function adoptTranslation(
  resumeId: number,
  variantId: number,
  items: { path: string; text: string }[],
): Promise<AdoptTranslationOut> {
  return request(variantBase(resumeId) + "/" + variantId + "/adopt", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function listGlossaryTerms(): Promise<{ items: GlossaryTerm[] }> {
  return request("/glossary-terms");
}

export function createGlossaryTerm(payload: GlossaryTermIn): Promise<GlossaryTerm> {
  return request("/glossary-terms", { method: "POST", body: JSON.stringify(payload) });
}

export function updateGlossaryTerm(
  termId: number,
  payload: GlossaryTermUpdate,
): Promise<GlossaryTerm> {
  return request("/glossary-terms/" + termId, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteGlossaryTerm(termId: number): Promise<void> {
  return request("/glossary-terms/" + termId, { method: "DELETE" });
}

/** 界面用的候选视图（复用既有 TranslationCandidate 类型）。 */
export type { TranslationCandidate };
