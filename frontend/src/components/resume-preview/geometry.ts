// SPDX-License-Identifier: Apache-2.0
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  type AvailableSpace,
  MAX_ZOOM,
  PAGE_STACK_GAP_PX,
} from "./config";
import {
  overflowHeightFor,
  pagesNeededFor,
  type LayoutMeasure,
} from "../../utils/resumeLayoutMeasure";

interface PreviewGeometryInput {
  availableSpace: AvailableSpace;
  paperHeight: number;
  pageCount: number;
  zoom: number;
  overflow: boolean;
  naturalWidth: number;
  /** 两页之间的间隙（未缩放 px）＝ 左右页边距之和，由 `layoutFrame` 按当前页边距量出。 */
  pageGap: number;
  measure: LayoutMeasure | null;
}

export interface PreviewGeometry {
  viewportWidth: number;
  viewportHeight: number;
  contentUnitHeight: number;
  contentTotalWidth: number;
  contentTotalHeight: number;
  fitScale: number;
  scale: number;
  viewportHeightForPage: number;
  scaledWidth: number;
  scaledHeight: number;
  pagesNeeded: number;
  overflowAmount: number;
  totalVisualPages: number;
  separatorCount: number;
  /** 页间隙（未缩放 px）：画布按 `pageGap × scale` 画分页条。 */
  pageGap: number;
  overflowAmountText: string;
  /** 溢出内容被裁掉（1 页上限）：提示里要说"超出的部分不会显示"，而不是"多页视图"。 */
  overflowClipped: boolean;
}

export function calculatePreviewGeometry({
  availableSpace,
  paperHeight,
  pageCount,
  zoom,
  overflow,
  pageGap,
  measure,
}: PreviewGeometryInput): PreviewGeometry {
  const viewportWidth = availableSpace.width || A4_WIDTH_PX;
  const viewportHeight = availableSpace.height || paperHeight;
  // 多页时按 A4 **竖向堆叠**（2026-10-21 用户要求，取代原来的横向并排）：
  // 横向并排要看第 2 页得先横滚，而简历的阅读顺序是从上往下。
  //
  // **页数恒等于用户设定的上限**（2026-10-21 第二次调整）：内容超出就截断，不再顺延出
  // 第 N+1 页。以前"溢出多排一页"是为了让用户看见"还差多少"，但那份"多出来的预览页"
  // 与导出的实际结果（同样超页）并不是一回事，反而让人以为导出也会多给一页。现在
  // 溢出的提示交给告警条，纸面只画用户要的那几页——想看更多自己把篇幅调大。
  const stackedPages = pageCount > 1;
  const totalVisualPages = stackedPages ? pageCount : 1;
  // 单页的"一页高"：`fitScale` 永远按**一页**算，保证任何一页都能完整落在视口里。
  const contentUnitHeight = stackedPages ? A4_HEIGHT_PX : paperHeight;
  const contentTotalWidth = A4_WIDTH_PX;
  const contentTotalHeight = stackedPages
    ? A4_HEIGHT_PX * totalVisualPages + PAGE_STACK_GAP_PX * (totalVisualPages - 1)
    : paperHeight;
  const fitScale = Math.min(1, viewportWidth / A4_WIDTH_PX, viewportHeight / contentUnitHeight);
  const scale = Math.min(MAX_ZOOM, fitScale * zoom);
  const viewportHeightForPage = Math.min(contentUnitHeight * fitScale, viewportHeight);
  const scaledWidth = contentTotalWidth * scale;
  const scaledHeight = contentTotalHeight * scale;
  const pagesNeeded = measure ? pagesNeededFor(measure) : overflow ? pageCount + 1 : pageCount;
  const overflowAmount = measure ? overflowHeightFor(measure) : 0;
  const overflowAmountText = measure
    ? (() => {
        const ratio = overflowAmount / measure.pageContentHeight;
        return ratio < 1
          ? `正文还多出约 ${Math.max(1, Math.round(ratio * 100))}% 的一页高度。`
          : `正文还多出约 ${ratio.toFixed(1)} 页的高度。`;
      })()
    : "暂时量不到精确的超出量。";

  return {
    viewportWidth,
    viewportHeight,
    contentUnitHeight,
    contentTotalWidth,
    contentTotalHeight,
    fitScale,
    scale,
    viewportHeightForPage,
    scaledWidth,
    scaledHeight,
    pagesNeeded,
    overflowAmount,
    totalVisualPages,
    // 竖排后不再有"页间隙条"：页与页之间是真实的空白 + 每页自己的边框/阴影。
    separatorCount: 0,
    pageGap,
    overflowAmountText,
    // 2026-10-21 起**溢出总是被裁**：页数恒等于上限，多出来的内容不在任何一页上。
    // 这个标志只用来选提示文案（"超出上限的部分不会显示"）。
    overflowClipped: overflow,
  };
}
