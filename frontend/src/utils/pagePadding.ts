// SPDX-License-Identifier: Apache-2.0
/** 简历页边距（mm）：取值范围的唯一实现（R1 / T5）。
 *
 * 为什么单独成文件：`react-refresh` 要求组件文件只导出组件；更重要的是这个范围必须
 * 与后端 `FORMAT_FIELDS.page_padding` 的 min/max **逐字一致**——两边不一致的表现是
 * "设了 30mm，导出还是默认值"（越界值被后端白名单整条丢弃），最难被发现的一类失败。
 *
 * T5 起入口从导出面板搬到预览的排版栏（`components/resume/PagePaddingControl`），
 * 落点仍是 `format_config.page_padding`：预览、保存、导出读的是同一个键。
 */

/** 与后端 `services/resume/resume_template_format.py` 的 page_padding min 一致。 */
export const MIN_PAGE_PADDING = 0;
/** 与后端 `services/resume/resume_template_format.py` 的 page_padding max 一致。 */
export const MAX_PAGE_PADDING = 26;

/**
 * 把任意数字收进 0–26 并收口到 **0.1mm**；NaN 一并挡在外面（回落到下限而不是把 NaN 发出去）。
 *
 * 下限 0（2026-10-22 用户要求）：要"正文铺满整张纸"时 8mm 是硬墙，滑杆直接停在 0 才有意义。
 *
 * 0.1 而不是整数（2026-10-21 用户要求）：1mm 一档时常常是"小 1mm 就断行、大了装不下"，
 * 中间没有可用值。收口到一位小数还有个副作用好处——滑块拖动产生的浮点尾巴
 * （14.300000000000001）不会漏到读数与落库值里。
 */
export function clampPagePadding(value: number): number {
  if (!Number.isFinite(value)) return MIN_PAGE_PADDING;
  const clamped = Math.min(MAX_PAGE_PADDING, Math.max(MIN_PAGE_PADDING, value));
  return Math.round(clamped * 10) / 10;
}
