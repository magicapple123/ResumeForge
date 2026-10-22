// SPDX-License-Identifier: Apache-2.0
import { A4_WIDTH_PX, columnGeometry, columnsCss, PAGE_GAP_PX } from "./config";
import {
  measureResumeLayout,
  pagesNeededFor,
  type LayoutMeasure,
} from "../../utils/resumeLayoutMeasure";

export interface FrameLayoutResult {
  measure: LayoutMeasure | null;
  overflow: boolean;
  /** 溢出内容被裁掉（而不是向右多排一列）。 */
  overflowClipped: boolean;
  naturalWidth: number;
  pagesNeeded: number;
  visualPages: number;
  /** 两页之间的间隙（未缩放 px）＝ 左右页边距之和；分页线按它画。 */
  pageGap: number;
}

interface Options {
  document: Document;
  pageCount: number;
  paperHeight: number;
}

/**
 * 测量 iframe 并把需要的多页列数固定下来。
 *
 * 测量一定发生在单列状态，避免 columns 把纵向高度折叠后让页数看起来变少；测量完成后再
 * 写入固定 column-count。这样内容实际需要两页时，渲染列数、外层纸张宽度和虚线数量始终
 * 来自同一个 pagesNeeded，而不会再通过 scrollWidth 猜出第四页。
 *
 * **列宽与列间距必须按当前页边距算，不能写死**（2026-10-20 用户实测）：
 * 默认页边距 14mm 时「182mm 列宽 + 28mm 间距」正好等于一页 210mm，可一旦把页边距调到
 * 20mm，列就比纸面宽——正文溢到第二页；调到 10mm 时列又比纸面窄——正文被页边界切掉。
 * 所以这里读 body 的实际 padding，令
 *   列宽 = 210mm − 左 − 右，列间距 = 左 + 右，
 * 于是第 N 列正好落在第 N 张纸的内容区里，与页边距无关。
 *
 * **左、右不相等时同样成立**（2026-10-22 四向页边距）：下面量的是"正文可用宽度"这个
 * **单一标量**，`pageGap = 210 − 可用宽度` 因此天然等于"左 + 右"——不需要分别拿到
 * 左和右。第 N 页内容起点 `N × 210 + 左` 与 `N × (columnWidth + pageGap) + 左` 相等，
 * 所以非对称版式不会让第 2 页错位，本文件**不需要任何改动**。
 */
export function layoutFrame({
  document,
  pageCount,
  paperHeight,
}: Options): FrameLayoutResult | null {
  const body = document.body;
  const root = document.documentElement;
  if (!body || !root) return null;

  body.style.width = "";
  body.style.height = "";
  // 回到单列（测量口径），同时撤掉"多列"标记：下面重新决定要不要分列。
  delete body.dataset.previewColumns;
  const style =
    (document.getElementById("resume-preview-style") as HTMLStyleElement | null) ??
    document.createElement("style");
  style.id = "resume-preview-style";
  style.textContent = "";
  if (!style.parentElement) document.head.appendChild(style);

  // 先量正文实际能用的宽度（此刻还没有任何分栏样式，量到的就是这份简历当前版式的宽度）。
  //
  // 三级兜底，任何一级量不到都不能算出"间隙 0、列宽 = 整页"这种把两页糊在一起的几何：
  // 1）`.header` / `.section` 这些满宽块的实际盒子宽度（最可靠，与模板用 mm / calc /
  //    不对称 padding 都无关）；
  // 2）body 的计算宽度；
  // 3）都没有（iframe 还在 about:blank、或拿到的是上一份已卸载的文档）→ 默认 14mm 页边距
  //    对应的 688 / 106。
  //
  // 为什么必须有第三级：`document.defaultView` 在卸载中的文档上是 null，读出来 padding 全 0，
  // 于是列宽 = 794、间隙 = 0、两列首尾相接——用户看到的就是"第 2 页正文顶到第 1 页边上"。
  const bodyStyle = document.defaultView?.getComputedStyle(body);
  const computedWidth = Number.parseFloat(bodyStyle?.width ?? "") || 0;
  const probe = body.querySelector(".header") ?? body.querySelector(".section");
  const probeWidth = probe ? probe.getBoundingClientRect().width : 0;
  const measuredCandidates = [probeWidth, computedWidth];
  // 页边距最小档是 5mm（≈19px）。量出来的"正文宽度"如果几乎等于整页（留白 < 8px），
  // 说明量到的是没排版的空文档 / 已卸载的旧文档，而不是真的没有页边距——直接判为无效，
  // 否则会算成"间隙 0、两列首尾相接"（用户截图里两页糊在一起就是这个）。
  const MIN_PAGE_INSET_PX = 8;
  const measuredWidth =
    measuredCandidates.find((w) => w > 0 && w <= A4_WIDTH_PX - MIN_PAGE_INSET_PX) ?? 0;
  const { pageGap, columnWidth } =
    measuredWidth > 0
      ? { pageGap: A4_WIDTH_PX - measuredWidth, columnWidth: measuredWidth }
      : columnGeometry(PAGE_GAP_PX / 2, PAGE_GAP_PX / 2);

  const measured = measureResumeLayout(document, pageCount);

  // **溢出判定只读、绝不改版式**（2026-10-21 用户要求）。
  //
  // 此前这里有一条兜底：探针没跑（或没量到 data-scale）时按
  // `min(1, 页宽/内容宽, 页高/内容高)` 写一个 `--fit-scale` 把整份简历压小。后果是
  // 滑杆上的 18px 在纸面上可能是 11px——"参数"与"呈现"从此各说各话。现在没有任何缩放：
  // 装不下就标 overflow，由界面提示加页 / 收紧排版。
  //
  // `scrollHeight` 不受 `body { overflow: hidden }` 影响，量的就是真实内容高；单页的溢出
  // 只体现在"高"上，多页则由下面的 `pagesNeeded`（列数）体现，两边都要看。
  let overflow =
    body.dataset.overflow === "1" ||
    body.scrollHeight > paperHeight + 1 ||
    root.scrollHeight > paperHeight + 1;

  const pagesNeeded = measured ? pagesNeededFor(measured) : overflow ? pageCount + 1 : pageCount;
  overflow = overflow || pagesNeeded > pageCount;
  // 选择多页本身就是横向分页，不要等内容溢出后才切 columns；否则 2/3 页内容较少时
  // 会被错误地画成一张纵向长纸。1 页时**不分列**，溢出的部分由 iframe 视口自然裁掉——
  // 这正是"超出就截断"在草稿侧的落点（2026-10-21 用户要求）。
  //
  // **列数恒等于用户设定的页数**：多出来的内容不在任何一列里（`column-fill: auto` 会把它
  // 排到容器外面，被 `overflow: hidden` 裁掉），而不是再顺延出第 N+1 页——否则用户会以为
  // 导出也会多给一页。
  const useColumns = pageCount > 1;
  const visualPages = useColumns ? pageCount : 1;
  style.textContent = useColumns
    ? columnsCss({
        columnCount: visualPages,
        pageWidth: A4_WIDTH_PX,
        columnWidth,
        columnGap: pageGap,
      })
    : "html,body{overflow:hidden!important}";
  // 告诉模板里的溢出探针"现在已经是多列状态，别在这里量"：
  // 分列后 `body.scrollHeight` 只剩一页高（高度被列折叠了），量出来的 `data-overflow`
  // 没有意义。测量阶段会先删掉这个标记，保证 `measureResumeLayout` 始终在单列状态下量。
  if (useColumns) body.dataset.previewColumns = "1";

  // 令 columns 真正参与布局；宽度不再用于反推页数，只作为画布尺寸。
  if (useColumns) void body.offsetWidth;
  const naturalWidth = useColumns ? A4_WIDTH_PX * visualPages : A4_WIDTH_PX;

  return {
    measure: measured,
    overflow,
    overflowClipped: overflow && !useColumns,
    naturalWidth,
    pagesNeeded,
    visualPages,
    pageGap,
  };
}
