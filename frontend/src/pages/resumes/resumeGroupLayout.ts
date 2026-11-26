// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图的列宽（唯一一份）。
 *
 * 父表（`<Table>` 的列宽）与展开后的版本行（`.resume-version-row` 的栅格）必须对着
 * 同一条竖线，两边各写一套数字的话，改一次列宽就会错位一次。所以数字只在这里定义，
 * 版本行把 `versionGridColumns()` 的返回值直接作为 `grid-template-columns`。
 *
 * 窄档（`mqMax("narrow")`）只收窄时间列，并**去掉了「投递」列**——见
 * `resumeGroupedColumns.tsx` 的说明（为什么不是给 `td` 加 `display: none`）。
 */
export const GROUP_COLUMN_WIDTHS = {
  /** 最近更新：`2026-11-10 21:40` 的量级，148 够放且不挤。 */
  updated: 148,
  /** 窄档的时间列：只留日期与短时间。 */
  updatedNarrow: 118,
  /** 投递次数："12 次" 这种 3–4 个字符。 */
  delivery: 72,
  /** 操作：两个文字按钮 + 一个「⋯」。 */
  actions: 186,
  /** 版本行的「第 N 版」标记。 */
  versionIndex: 44,
} as const;

/** 版本行的栅格：与父表 5 列一一对应（展开列由父表自带，这里只对齐内容区）。 */
export function versionGridColumns(narrow: boolean): string {
  const updated = narrow ? GROUP_COLUMN_WIDTHS.updatedNarrow : GROUP_COLUMN_WIDTHS.updated;
  const delivery = narrow ? "0px" : `${GROUP_COLUMN_WIDTHS.delivery}px`;
  return `${GROUP_COLUMN_WIDTHS.versionIndex}px minmax(0, 1fr) ${updated}px ${delivery} ${GROUP_COLUMN_WIDTHS.actions}px`;
}
