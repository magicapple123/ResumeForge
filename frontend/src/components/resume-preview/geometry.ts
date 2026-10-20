// SPDX-License-Identifier: Apache-2.0
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  EXPAND_OVERFLOW_ON_SINGLE_PAGE,
  type AvailableSpace,
  MAX_ZOOM,
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
  naturalWidth,
  pageGap,
  measure,
}: PreviewGeometryInput): PreviewGeometry {
  const viewportWidth = availableSpace.width || A4_WIDTH_PX;
  const viewportHeight = availableSpace.height || paperHeight;
  // 选择 2/3 页时即使内容没有溢出，也固定按 A4 列横向展示；溢出只是把列数继续扩展。
  // 唯一的例外是 **1 页上限**：不因溢出而多排一列（见 `EXPAND_OVERFLOW_ON_SINGLE_PAGE`）。
  const horizontalPages = pageCount > 1 || (overflow && EXPAND_OVERFLOW_ON_SINGLE_PAGE);
  const totalVisualPages = horizontalPages
    ? Math.max(overflow ? pageCount + 1 : pageCount, Math.round(naturalWidth / A4_WIDTH_PX))
    : 1;
  const contentUnitHeight = horizontalPages ? A4_HEIGHT_PX : paperHeight;
  const contentTotalWidth = horizontalPages
    ? Math.max(naturalWidth, A4_WIDTH_PX * totalVisualPages)
    : A4_WIDTH_PX;
  const contentTotalHeight = horizontalPages ? A4_HEIGHT_PX : paperHeight;
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
    separatorCount: horizontalPages ? totalVisualPages - 1 : 0,
    pageGap,
    overflowAmountText,
    overflowClipped: overflow && !horizontalPages,
  };
}
