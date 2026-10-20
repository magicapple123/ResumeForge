/** 简历页边距（mm）：取值范围的唯一实现（R1 / T5）。
 *
 * 为什么单独成文件：`react-refresh` 要求组件文件只导出组件；更重要的是这个范围必须
 * 与后端 `FORMAT_FIELDS.page_padding` 的 min/max **逐字一致**——两边不一致的表现是
 * "设了 30mm，导出还是默认值"（越界值被后端白名单整条丢弃），最难被发现的一类失败。
 *
 * T5 起入口从导出面板搬到预览的版式栏（`components/resume/PagePaddingControl`），
 * 落点仍是 `format_config.page_padding`：预览、保存、导出读的是同一个键。
 */

/** 与后端 `services/resume/resume_template_format.py` 的 page_padding min 一致。 */
export const MIN_PAGE_PADDING = 8;
/** 与后端 `services/resume/resume_template_format.py` 的 page_padding max 一致。 */
export const MAX_PAGE_PADDING = 26;

/** 把任意数字收进 8–26 并取整；NaN 一并挡在外面（回落到下限而不是把 NaN 发出去）。 */
export function clampPagePadding(value: number): number {
  if (!Number.isFinite(value)) return MIN_PAGE_PADDING;
  return Math.min(MAX_PAGE_PADDING, Math.max(MIN_PAGE_PADDING, Math.round(value)));
}
