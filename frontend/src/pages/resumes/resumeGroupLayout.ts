// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图的列宽（唯一一份）。
 *
 * 父表（`<Table>` 的列宽）与展开后的版本行（`.resume-version-row` 的栅格）必须对着
 * 同一条竖线，两边各写一套数字的话，改一次列宽就会错位一次。所以数字只在这里定义，
 * 版本行把 `versionGridColumns()` 的返回值直接作为 `grid-template-columns`。
 *
 * ## 栅格为什么"没有间距"也没有自己的内边距（2026-11-26 的 32px 偏差）
 *
 * 上一版版本行是 `column-gap: 8px` + 列表 `padding-left: 16px` + 每列自己定宽：
 * 列宽数字虽与父表同源，但**能用的宽度**不同——展开行的 `td` 先吃掉左右各 8px 内边距，
 * 列表再吃掉 16px，4 个栅格间距又吃掉 32px。父表那一侧是靠 `td` 的 padding 定位文字的。
 * 两种算法叠在一起，尾随三列就整体左移：实测 940 视口「最近更新」列左缘 576 vs 父表 608
 * （−32px），「操作」列左缘 720 vs 728（−16px）。
 *
 * 现在的口径是"一份宽度、一套内边距"：
 * 1. 版本行铺满整行（展开行 `td` 的横向 `padding` 置 0），栅格总宽 == 父表内容宽；
 * 2. 首格 `minmax(0,1fr)` 同时吃掉父表的**展开列 + 身份列**（身份列是父表里唯一不写宽度、
 *    靠剩余空间算出来的列，只有并在一起两边才算出同一个数）；
 * 3. 栅格不再有 `column-gap`，每格的横向内边距取 `--rf-group-cell-pad-x`
 *    （`resumeGroupTable.css` 里同时是 `th`/`td` 的 `padding-inline`）。
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
  /** 版本行的「第 N 版」标记（栅格首格里的定宽前缀，不参与列宽分配）。 */
  versionIndex: 44,
  /**
   * 父表的展开列（antd 的箭头列）。必须显式给宽度：`tableLayout: fixed` 下没有宽度
   * 的列会去瓜分剩余空间，而身份列也正是"没有宽度"的那一列，两者会各分一半。
   */
  expand: 44,
} as const;

/**
 * 版本行栅格的列宽串（`grid-template-columns`）。
 *
 * 与父表**同一套列**：首格 `minmax(0,1fr)` 吃掉「展开列 + 身份列」，其余列照抄
 * `GROUP_COLUMN_WIDTHS`；没有 `column-gap`，横向呼吸由每格的 `--rf-group-cell-pad-x`
 * 提供（详见文件头）。所以这里返回的跟踪列数量永远比父表少 1（父表的展开列被首格吸收）。
 *
 * 窄档父表**不下发**投递列（见 `resumeGroupedColumns.tsx`），这里也必须跟着少一列：
 * 留一个 `0px` 的空跟踪列虽然在父表里"看不见"，但它仍然会跟着后面的列一起参与排布，
 * 是"少一列"与"零宽列"两种口径混用的开始（`ResumeGroupedTable.test.tsx` 为此守了一条）。
 */
export function versionGridColumns(narrow: boolean): string {
  const updated = narrow ? GROUP_COLUMN_WIDTHS.updatedNarrow : GROUP_COLUMN_WIDTHS.updated;
  // `minmax(0,1fr)` 不写空格，方便用例按空格切分核对（CSS 不要求空格）。
  const leading = "minmax(0,1fr)";
  if (narrow) {
    return `${leading} ${updated}px ${GROUP_COLUMN_WIDTHS.actions}px`;
  }
  return `${leading} ${updated}px ${GROUP_COLUMN_WIDTHS.delivery}px ${GROUP_COLUMN_WIDTHS.actions}px`;
}
