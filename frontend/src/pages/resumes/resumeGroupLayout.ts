// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图的列宽（唯一一份）。
 *
 * 父表（`<Table>` 的列宽）与展开后的版本行（`.resume-version-row` 的栅格）必须对着
 * 同一条竖线，两边各写一套数字的话，改一次列宽就会错位一次。所以数字只在这里定义，
 * 版本行把 `versionGridColumns()` 的返回值直接作为 `grid-template-columns`。
 *
 * ## 这些数字是"**上限**"，不是"参考值"（2026-11-26 窄档裁字事故的教训）
 *
 * 父表必须 `tableLayout="fixed"`：`auto` 布局下浏览器会把每一列撑到它的 min-content，
 * 而"岗位名"那一列是 `white-space: nowrap`（要省略号，不要换行），min-content 就是
 * 整串岗位名的宽度。实测 940 视口（内容盒 834）时岗位列被撑到 653，四列合计 968 →
 * 超出容器 134px，「操作」列连同半个「展开」被 `.ant-table-content` 裁掉。
 * 所以：**身份列不写宽度**（`fixed` 布局里它独占剩余空间，由内部省略号负责收缩），
 * 其余列写死，总和必须留得住身份列的最小可用宽度。
 *
 * 窄档（`mqMax("narrow")`）只收窄时间列，并**去掉了「投递」列**——见
 * `resumeGroupedColumns.tsx` 的说明（为什么不是给 `td` 加 `display: none`）。
 */
export const GROUP_COLUMN_WIDTHS = {
  /** 最近更新：`2026-11-10 21:40` 的量级，148 够放且不挤。 */
  updated: 148,
  /**
   * 窄档的时间列。
   *
   * `formatDateTime` 恒为 `YYYY-MM-DD HH:mm`（16 字符，等宽数字约 108px），加上单元格
   * 左右各 8px 内边距 ≈ 124px。原来的 118 是"看着差不多"，实际会被裁掉末尾的分钟；
   * 而 `fixed` 布局不会为它让位，文字会直接压到下一列上——所以这里必须写到 128。
   */
  updatedNarrow: 128,
  /** 投递次数："12 次" 这种 3–4 个字符。 */
  delivery: 72,
  /** 操作：两个文字按钮 + 一个「⋯」。 */
  actions: 186,
  /** 版本行的「第 N 版」标记。 */
  versionIndex: 44,
  /**
   * 父表的展开列（antd 的箭头列）。必须显式给宽度：`tableLayout: fixed` 下没有宽度
   * 的列会去瓜分剩余空间，而身份列也正是"没有宽度"的那一列，两者会各分一半。
   */
  expand: 44,
} as const;

/** 版本行的栅格：与父表 5 列一一对应（展开列由父表自带，这里只对齐内容区）。 */
export function versionGridColumns(narrow: boolean): string {
  const updated = narrow ? GROUP_COLUMN_WIDTHS.updatedNarrow : GROUP_COLUMN_WIDTHS.updated;
  const delivery = narrow ? "0px" : `${GROUP_COLUMN_WIDTHS.delivery}px`;
  return `${GROUP_COLUMN_WIDTHS.versionIndex}px minmax(0, 1fr) ${updated}px ${delivery} ${GROUP_COLUMN_WIDTHS.actions}px`;
}
