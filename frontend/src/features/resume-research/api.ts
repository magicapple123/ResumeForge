// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档模式」真实保存（W14-BE task-14 已交付）。
 *
 * 口径（be-render 转来的 W14 前端契约）：
 * - `PATCH /resumes/{id}/layout` 接受 `document_mode` + `page_limit`，后端按模式夹紧
 *   （resume 4→3、long_cv 11→10、10 在 long_cv 下可用）；
 * - 这是**整体替换**接口：必须带上当前版式其余字段，否则会静默把模板/字号/语言重置；
 *   所以这里从宿主传入的当前 `layout` 构造完整 payload，只覆盖 mode 与 page_limit。
 * - 条件写沿用 W02：宿主有 `expectedRevision` 就带上，过期回 409 由宿主处理（不覆盖）。
 */
import { request } from "../../api/client";
import type { ResumeDetail, ResumeLayout } from "../../types";
import { clampPageLimit, normalizeDocumentMode, type DocumentMode } from "./documentMode";

export interface DocumentModePatch {
  mode: DocumentMode;
  pageLimit: number;
}

export function buildLayoutPayload(
  layout: ResumeLayout,
  patch: DocumentModePatch,
): Record<string, unknown> {
  const mode = normalizeDocumentMode(patch.mode);
  return {
    template: layout.template,
    format_name: layout.format_name,
    // 前端先按同一组区间夹一遍（后端还会再夹一次）：控件当场显示的就是将要保存的值。
    page_limit: clampPageLimit(mode, patch.pageLimit),
    document_mode: mode,
    font_scale: layout.font_scale,
    language: layout.language ?? undefined,
    // null = 本次不涉及（与空字典"清空覆盖"区分）。
    format_config: layout.format_config ?? null,
  };
}

/** 保存文档模式 + 夹紧后的页数；返回后端最新详情（含夹紧后的真实 page_limit）。 */
export function saveDocumentMode(
  resumeId: number,
  layout: ResumeLayout,
  patch: DocumentModePatch,
  expectedRevision?: number | null,
): Promise<ResumeDetail> {
  return request("/resumes/" + resumeId + "/layout", {
    method: "PATCH",
    body: JSON.stringify({
      ...buildLayoutPayload(layout, patch),
      expected_revision: expectedRevision ?? undefined,
    }),
  });
}

/** 目录下发的模式区间 / 长 CV 默认页数（旧后端没有时返回 undefined，界面回落到本地兜底）。 */
export interface ModeLimitsFromCatalog {
  limits?: Partial<Record<DocumentMode, readonly [number, number]>>;
  defaultLongCvPageLimit?: number;
}

export function modeLimitsFromCatalog(catalog: unknown): ModeLimitsFromCatalog {
  if (!catalog || typeof catalog !== "object") return {};
  const record = catalog as Record<string, unknown>;
  const raw = record.mode_page_limits;
  const limits: Partial<Record<DocumentMode, readonly [number, number]>> = {};
  if (raw && typeof raw === "object") {
    for (const mode of ["resume", "long_cv"] as const) {
      const value = (raw as Record<string, unknown>)[mode];
      if (Array.isArray(value) && value.length === 2) {
        const min = Number(value[0]);
        const max = Number(value[1]);
        if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
          limits[mode] = [min, max];
        }
      }
    }
  }
  const fallback = Number(record.long_cv_default_page_limit);
  return {
    limits: Object.keys(limits).length > 0 ? limits : undefined,
    defaultLongCvPageLimit: Number.isFinite(fallback) ? fallback : undefined,
  };
}
