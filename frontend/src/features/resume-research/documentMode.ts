// SPDX-License-Identifier: Apache-2.0
/**
 * 长 CV 文档模式（W14 / P2-02）的**纯规则**：页数区间、夹紧、切换时的提示判据。
 *
 * ## 为什么这些常量写在前端
 *
 * 权威值在后端（`schemas/resume_generation.py` 的 `MAX_RESUME_PAGES = 3` /
 * `LONG_CV_MAX_PAGES = 10` / `MODE_PAGE_LIMITS`）。前端这份是**旧后端兜底**：
 * 目录接口还没下发 `mode_page_limits` 时，控件不能因为没有区间就渲染成空下拉。
 * 契约（§5.4）要求两端一致，所以这里用一条测试钉住"若目录下发则用下发的值"。
 *
 * ## 切换语义（与契约逐条对应）
 *
 * - 普通简历 ↔ 长 CV **不转换内容、不改模板、不清版式**；只改页数上限与默认值。
 * - 切回普通简历时若当前页数 > 3 → **夹紧到 3 并返回 clamped=true**（界面提示，
 *   不静默丢页数）。
 * - 长 CV 默认 2 页（lead 2026-10-24 拍板）。
 */

/** 文档模式。与后端 `document_mode` 列的取值逐字一致。 */
export type DocumentMode = "resume" | "long_cv";

export const DOCUMENT_MODES: readonly DocumentMode[] = ["resume", "long_cv"];

/** 每种模式允许的页数区间（闭区间）。 */
export const MODE_PAGE_LIMITS: Record<DocumentMode, readonly [number, number]> = {
  resume: [1, 3],
  long_cv: [1, 10],
};

/** 长 CV 的默认页数（lead 拍板：2）。 */
export const LONG_CV_DEFAULT_PAGE_LIMIT = 2;

/** 普通简历的默认页数（与既有 `DEFAULT_PAGE_LIMIT = 1` 一致）。 */
export const RESUME_DEFAULT_PAGE_LIMIT = 1;

/** 把任意值归一成合法模式：未知/空值一律当普通简历（旧记录没有 `document_mode`）。 */
export function normalizeDocumentMode(value: unknown): DocumentMode {
  return value === "long_cv" ? "long_cv" : "resume";
}

/** 某模式的页数区间；传入已归一的值。 */
export function pageLimitRange(mode: DocumentMode): readonly [number, number] {
  return MODE_PAGE_LIMITS[mode];
}

/** 把页数夹进模式的区间。非整数按四舍五入取整；NaN 落回该模式默认值。 */
export function clampPageLimit(mode: DocumentMode, value: number): number {
  const [min, max] = pageLimitRange(mode);
  if (!Number.isFinite(value)) return defaultPageLimit(mode);
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

/** 某模式可选的页数列表（控件用）。 */
export function pageLimitOptions(mode: DocumentMode): number[] {
  const [min, max] = pageLimitRange(mode);
  return Array.from({ length: max - min + 1 }, (_unused, index) => min + index);
}

/** 新建/切换时的默认页数：普通 1 页、长 CV 2 页。 */
export function defaultPageLimit(mode: DocumentMode): number {
  return mode === "long_cv" ? LONG_CV_DEFAULT_PAGE_LIMIT : RESUME_DEFAULT_PAGE_LIMIT;
}

/** 切换模式后应该落到哪一页，以及是否发生了夹紧（界面据此提示）。 */
export function pageLimitOnModeSwitch(
  currentPageLimit: number,
  nextMode: DocumentMode,
): { pageLimit: number; clamped: boolean } {
  const pageLimit = clampPageLimit(nextMode, currentPageLimit);
  return { pageLimit, clamped: pageLimit !== Math.round(currentPageLimit) };
}

/** 排版结果是否超过当前上限（"约需 N 页（上限 M 页）"的判据）。 */
export function isOverBudget(pagesNeeded: number | null | undefined, pageLimit: number): boolean {
  return typeof pagesNeeded === "number" && Number.isFinite(pagesNeeded) && pagesNeeded > pageLimit;
}
