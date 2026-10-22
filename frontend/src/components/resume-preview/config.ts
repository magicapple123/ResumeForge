// SPDX-License-Identifier: Apache-2.0
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";

export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;
/** 多页并排时页与页之间“裁切间隙”的未缩放宽（px）。两侧纸边阴影让它看起来是两张独立的纸。 */
// 默认值（左右各 14mm 页边距时 = 28mm ≈ 106px）；真正的间隙由 `layoutFrame` 按
// 这份简历当前的页边距量出来（`pageGap`），这里只是首次测量前的占位。
export const PAGE_GAP_PX = 106;
/**
 * 竖排多页时页与页之间的空隙（CSS px，随整体缩放一起变）。
 *
 * 2026-10-21 用户要求把多页从"横向并排"改成"竖向堆叠"：横向并排要看第二页得先横滚，
 * 而简历的阅读顺序本来就是从上往下。这里只是**视觉间隔**——每页内部仍是同一套
 * CSS 多列分页（列宽/列间距由页边距算），断点口径没有变。
 */
export const PAGE_STACK_GAP_PX = 24;
export const PREVIEW_BOTTOM_RESERVE = 150;
export const PREVIEW_HEIGHT_RATIO = 0.62;
export const MIN_PREVIEW_HEIGHT = 360;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3.5;
export const PROBE_STYLE_ID = "resume-fit-probe";
export const LIVE_PROBE_STYLE_ID = "resume-font-live-probe";

/**
 * 1 页上限时，溢出的内容要不要再向右排成第 2 列？
 *
 * - `false`（当前）：**贴住上限**——只有一张 A4，超出的部分不显示
 *   （2026-10-20 用户要求：选 1 页时不要把放不下的内容又拉通成几页）。
 * - `true`：回到更早的行为，溢出内容继续向右展开成第 2 列（只看不改）。
 *
 * 选 2 / 3 页时不受这个开关影响：多页本来就是横向并排——用户 2026-10-20 再次确认
 * 要保留这种"几张 A4 并排"的形态，不接受上下叠。
 */
export const APPROXIMATE_PAGINATION_NOTE =
  "多页视图为「按 A4 高度切分的近似分页」，真实分页以「浏览器打印 / 下载 PDF」为准。";

/** 溢出内容不显示时（1 页上限）的说明。 */
export const OVERFLOW_NOTE = "超出上限的部分不会显示——先收紧排版或增加页数才能看全。";

/**
 * 精确预览的溢出说明：比 `OVERFLOW_NOTE` 多一句"不自动缩小"。
 *
 * **不要在这里另写一份后果句**：精确口径与草稿口径必须说同一句话（"先收紧排版或增加
 * 页数"），只是精确侧要先补上"字号线距页边距按你设的值原样渲染、不会自动缩小"这条事实。
 * 2026-10-22 就是这条尾巴各写了一份，常量里改成「排版」之后精确预览还留着「版式」，
 * 同一个界面上两份互相打架的说明。
 */
export const EXACT_OVERFLOW_NOTE = `字号、行距、页边距都按你设定的值原样渲染，不会自动缩小；${OVERFLOW_NOTE}`; // i18n-ok: 前半句是从 ExactPreviewPanel 内联副本原样搬来的既有文案（本轮修「版式→排版」时收敛到常量），不是新增文案

export interface AvailableSpace {
  width: number;
  height: number;
}

/**
 * 预览口径：草稿（浏览器实时排版）/ 精确（服务端排出的真实 PDF）。
 *
 * 是**受控**状态：主预览与「查看大图」共用它，在一处切换，另一处跟着走。
 */
export type PreviewMode = "draft" | "exact";

export interface PanStart {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
}

/** 预览暴露给外部的命令式接口，只给「自动一页」等版式控件使用。 */
export interface ResumePreviewHandle {
  measureWithProbe(css: string): LayoutMeasure | null;
  setLiveProbe(css: string): void;
}

/**
 * 把连续流固定为指定数量的 A4 列。
 *
 * 不能只设置 column-width 再通过 scrollWidth 反推页数：列间距和 body 的边距也会被算进去，
 * 内容实际需要两页时可能被误画成三、四页。列数由测量结果直接决定，外层分隔线也因此有
 * 唯一的几何来源。
 *
 * **列宽/列间距按当前页边距传入，不写死**（2026-10-20 用户实测）：写死 182mm + 28mm 只在
 * 默认 14mm 页边距下成立——页边距调到 20mm 时列比纸面宽（正文溢到第二页），调到 10mm 时
 * 列比纸面窄（正文被页边界切掉）。调用方从 body 的实际 padding 算出这两个值。
 */
export interface ColumnsOptions {
  columnCount: number;
  /** 一页的宽度（px）：210mm ≈ 794。 */
  pageWidth: number;
  /** 一列（一页内容区）的宽度 = pageWidth − 左页边距 − 右页边距。 */
  columnWidth: number;
  /** 列间距 = 左右页边距之和，正好盖住两张纸之间的空白。 */
  columnGap: number;
}

/**
 * 由左右页边距算出一列的内容宽度与两列之间的间隙。
 *
 * 这是「横向分页不错位」的唯一口径：列宽 + 间隙恒等于一页宽，所以第 N 列永远落在
 * 第 N 张纸的内容区里。页边距越大，列越窄、页间隙越宽。
 *
 * **左、右两个参数是分开传的，所以 `paddingLeft ≠ paddingRight` 天然成立**（2026-10-22
 * 四向页边距）：`pageGap` 就是"左右之和"，`columnWidth` 就是"210mm − 左 − 右"。于是
 * "上 14 / 右 20 / 下 14 / 左 8"这种非对称版式下，第 N 页内容起点
 * `N × 210 + 左` 仍然等于 `N × (columnWidth + pageGap) + 左`——不需要任何额外分支。
 * 唯一的调用方 `layout.ts` 用的是 body / `.header` 的**实际盒子宽度**，量到的就是
 * `210mm − 左 − 右`。
 */
export function columnGeometry(paddingLeft: number, paddingRight: number) {
  const pageGap = Math.max(0, paddingLeft + paddingRight);
  return { pageGap, columnWidth: Math.max(1, A4_WIDTH_PX - pageGap) };
}

export function columnsCss({
  columnCount,
  pageWidth,
  columnWidth,
  columnGap,
}: ColumnsOptions): string {
  const count = Math.max(2, Math.round(columnCount));
  return (
    "html,body{overflow:hidden!important}" +
    `body{width:${(count * pageWidth).toFixed(2)}px!important;height:297mm!important;` +
    `column-width:${columnWidth.toFixed(2)}px!important;` +
    `column-gap:${columnGap.toFixed(2)}px!important;` +
    `column-count:${count}!important;column-fill:auto!important;` +
    "orphans:2;widows:2}" +
    // 分页列里不能把"一个条目"劈成两半：`.entry-head` 是 flex（左标题、右日期），
    // 列边界一旦落在它中间，就会出现"标题留在上一页、日期孤零零跑到下一页"
    // （2026-10-20 用户截图）。整条一起挪到下一页才符合"这是一段内容"的直觉。
    "body .header,body .entry,body .entry-head," +
    "body .item,body li,body table,body tr{break-inside:avoid;page-break-inside:avoid}" +
    // 小节标题不落在页尾（标题与正文被拆开同样像错位）。
    "body .section-title,body h1,body h2,body h3,body h4{break-after:avoid;page-break-after:avoid}"
  );
}
