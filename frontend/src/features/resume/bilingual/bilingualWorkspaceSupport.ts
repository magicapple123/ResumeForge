// SPDX-License-Identifier: Apache-2.0
/**
 * 双语工作区的窄类型与「接口返回 → 视图模型」适配（从 `BilingualWorkspaceV2.tsx` 拆出）。
 *
 * 拆出的原因只有一个：那个文件到 503 行，超 `tests/test_file_size_budget.py` 的 500 行预算
 * （同目录的 `bilingualPairLabels.ts` 也是这么来的）。这里只放**纯函数与类型**——没有 hook、
 * 没有请求、没有 i18n 文案，所以「什么时候调」留在组件里，「怎么适配」集中在这一处。
 */
import { ApiError } from "../../../api/client";
import type { VariantBriefOut } from "./api";
import type { LanguageVariant } from "./types";

/** 工作区页签：对照 / 翻译候选 / 术语表。 */
export type WorkspaceTab = "compare" | "candidates" | "glossary";

/** 本工作区只处理中英两向（与 `bilingualPairLabels` 的语言方向一致）。 */
export type LanguageCode = "zh-CN" | "en-US";

/**
 * 取错误里人能读的那句话。
 *
 * @param error 任意抛出物。
 * @returns 文案；取不到时返回空串，由调用方补 i18n 兜底文案。
 */
export function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

/**
 * 后端 400 = 「这次翻译没法开始」（最常见是还没配大模型 API，也可能是语言方向不对）。
 *
 * @param error 任意抛出物。
 * @returns 是 400 则 true。
 */
export function isRejectedByBackend(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

/**
 * 版本列表项（后端 brief）→ 视图用的 `LanguageVariant`。
 *
 * 后端 brief 只给"够画标签栏"的字段：这里补上 `created_at` 的字符串归一（`null` → 空串）
 * 与可选的 `updated_at`，别在组件里散着做。
 *
 * @param variant 版本 brief。
 * @returns 视图模型。
 */
export function briefToView(variant: VariantBriefOut): LanguageVariant {
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
