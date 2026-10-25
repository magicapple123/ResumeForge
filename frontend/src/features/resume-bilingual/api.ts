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
  /** 派生时的基底排版快照（0060 之前字段；导出以 layout/export-input 为准）。 */
  render_context?: Record<string, unknown>;
  /** W16 独立排版覆盖（0060）：null/缺省 = 继承。 */
  layout?: Record<string, unknown> | null;
}

/** W16 独立排版：PATCH layout=null 表示恢复继承。 */
export interface VariantLayoutPatchPayload {
  layout: Record<string, unknown> | null;
}

/** GET /variants/{id}/export-input：导出/预览取变体的唯一入口（be-prov 冻结契约）。 */
export interface VariantExportInputOut {
  resume_id: number;
  variant_id: number;
  name: string;
  language: string;
  content: Record<string, unknown>;
  layout: Record<string, unknown>;
  /** 生效排版来源：variant = 独立覆盖；其它 = 继承。 */
  layout_source: string;
  content_sha256: string;
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

/**
 * 为某个语言创建版本：POST variants 带 language（schema 已支持），
 * 旧后端忽略 language 时再 PATCH 一次语言标签（失败不吞错，由调用方提示）。
 */
export async function createLanguageVariant(
  resumeId: number,
  language: "zh-CN" | "en-US",
  name: string,
): Promise<VariantDetailOut> {
  const created = await request<VariantDetailOut>(variantBase(resumeId), {
    method: "POST",
    body: JSON.stringify({ name, language }),
  });
  if (created.language) return created;
  return request(variantBase(resumeId) + "/" + created.id, {
    method: "PATCH",
    body: JSON.stringify({ language }),
  });
}

/** 独立排版：PATCH layout；传 null = 清空覆盖、恢复继承。 */
export function patchVariantLayout(
  resumeId: number,
  variantId: number,
  payload: VariantLayoutPatchPayload,
): Promise<VariantDetailOut> {
  return request(variantBase(resumeId) + "/" + variantId, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** 变体导出输入（含生效排版与 layout_source）；预览/排版显示的唯一数据源。 */
export function fetchVariantExportInput(
  resumeId: number,
  variantId: number,
): Promise<VariantExportInputOut> {
  return request(variantBase(resumeId) + "/" + variantId + "/export-input");
}

export function translateVariant(
  resumeId: number,
  variantId: number,
  payload: TranslateVariantPayload,
): Promise<TranslateVariantOut> {
  return request(variantBase(resumeId) + "/" + variantId + "/translate", {
    method: "POST",
    body: JSON.stringify(payload),
    // 翻译候选要等后端把整份简历的可译段翻完（几十段、1–3 次模型调用）：
    // 默认 15s 预算必然误报「请求超时，请重试」。
    budget: "translate",
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
