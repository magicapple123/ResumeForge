// SPDX-License-Identifier: Apache-2.0
/**
 * 版面诊断卡的纯计算部分：草稿版式指纹与优化器"当前四项值"。
 *
 * 拆出来只为行数预算（卡片本身 500 行上限）；这里的函数不碰 DOM、不发请求，
 * 与渲染无关，单独放一个文件也更好读。
 */
import type { ResumeLayout, ResumeLayoutStatus } from "../../types";

/** 优化器要的"当前四项值"：由 layout.format_config 解析；缺省用经典模板基准（"未设过"）。 */
export const OPTIMIZER_FALLBACK_CURRENT = {
  page_padding: 14,
  section_gap: 1.3,
  line_height: 1.7,
  font_scale_adjust: 1,
} as const;

export function optimizerCurrentOf(layout: ResumeLayout) {
  const config = (layout.format_config ?? {}) as Record<string, unknown>;
  const numberOr = (key: keyof typeof OPTIMIZER_FALLBACK_CURRENT) =>
    typeof config[key] === "number" ? (config[key] as number) : OPTIMIZER_FALLBACK_CURRENT[key];
  return {
    page_padding: numberOr("page_padding"),
    section_gap: numberOr("section_gap"),
    line_height: numberOr("line_height"),
    font_scale_adjust: numberOr("font_scale_adjust"),
  };
}

export const STATUS_COLORS: Record<ResumeLayoutStatus, string> = {
  overflow: "red",
  dense: "orange",
  healthy: "green",
  sparse: "gold",
  too_sparse: "gold",
  unknown: "default",
};

/**
 * 草稿版式的稳定指纹：参数一变，诊断就必须重新取一次。
 *
 * 为什么不能只盯着测量值：`measureKey` 只反映"排出来多高"，而 `fit_room` / `fit_ladder`
 * 是**从当前这一版往紧收**算出来的——基准变了结论就得跟着变，哪怕高度暂时没动。
 * 排序是为了让"同一组版式"永远得到同一个串（`format_config` 的键序取决于插入顺序）。
 */
export function draftLayoutKey(layout: ResumeLayout): string {
  const config = Object.entries(layout.format_config ?? {})
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
  return `${layout.template}|${layout.format_name}|${layout.font_scale}|${config}`;
}
