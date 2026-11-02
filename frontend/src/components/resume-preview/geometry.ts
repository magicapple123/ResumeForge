// SPDX-License-Identifier: Apache-2.0
import { t } from "../../i18n";
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  type AvailableSpace,
  MAX_FIT_SCALE_DEFAULT,
  MAX_ZOOM,
  MIN_READABLE_SCALE,
  PAGE_STACK_GAP_PX,
} from "./config";
import {
  overflowHeightFor,
  pagesNeededFor,
  type LayoutMeasure,
} from "../../utils/resumeLayoutMeasure";
import { resolvePageCounts } from "./overflow";

interface PreviewGeometryInput {
  availableSpace: AvailableSpace;
  paperHeight: number;
  /** 用户设定的篇幅上限（导出按它截断）。 */
  pageCount: number;
  zoom: number;
  overflow: boolean;
  naturalWidth: number;
  /** 两页之间的间隙（未缩放 px）＝ 左右页边距之和，由 `layoutFrame` 按当前页边距量出。 */
  pageGap: number;
  measure: LayoutMeasure | null;
  /**
   * 服务端分页报告给出的页数（问题 3）：给了就以它定纸张数，`measure` 退为下界。
   * 不传 / null = 没有报告，退回浏览器测量。
   */
  reportedPages?: number | null;
  /**
   * 大屏放大上限（`--rf-a4-max-fit`，A 档 1.35）。
   * 不传 = 1，即"永不放大"——与 2026-10-23 之前的行为逐像素一致。
   */
  maxFitScale?: number;
  /**
   * 「适应」按哪一边算（Q21）：
   *
   * - `"page"`（默认，主预览）：宽高都放得下 —— 一页完整可见；
   * - `"width"`（制作台右栏）：**只按纸宽 ≤ 相框宽**，纵向滚动看全。
   *
   * 制作台右栏窄而高：按整页算会把纸缩到 62%，两侧留出大片灰边；按宽度算才是用户说的
   * "适应画布"（纸铺满右栏、右边框可见），纵向滚动本来就是右栏的常态。
   */
  fitMode?: "page" | "width";
}

export interface PreviewGeometry {
  viewportWidth: number;
  viewportHeight: number;
  contentUnitHeight: number;
  contentTotalWidth: number;
  contentTotalHeight: number;
  fitScale: number;
  scale: number;
  /**
   * fit 被可读下限抬起来了（容器根本放不下 55%）。
   * 为真时界面要给提示：纸比容器大，要滚动才能看全——不是"坏了"。
   */
  clampedToMin: boolean;
  viewportHeightForPage: number;
  scaledWidth: number;
  scaledHeight: number;
  pagesNeeded: number;
  overflowAmount: number;
  totalVisualPages: number;
  /** 超出上限的纸张数（0 = 没有超额页）。 */
  overflowPages: number;
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
  reportedPages,
  maxFitScale = MAX_FIT_SCALE_DEFAULT,
  fitMode = "page",
}: PreviewGeometryInput): PreviewGeometry {
  const viewportWidth = availableSpace.width || A4_WIDTH_PX;
  const viewportHeight = availableSpace.height || paperHeight;
  // 多页时按 A4 **竖向堆叠**（2026-10-21 用户要求，取代原来的横向并排）：
  // 横向并排要看第 2 页得先横滚，而简历的阅读顺序是从上往下。
  //
  // **页数 ≠ 用户设定的上限**（2026-11-02，问题 2 + 问题 3）：上限只是"导出的篇幅约束"，
  // 画布的画幅是"内容要几张纸"。两者取大：超限的页照样画出来并带超额角标，不再把第 4 列
  // 之后的内容静默裁掉；而页数本身以服务端 `pagination/report` 为准（见 `overflow.ts`）。
  const counts = resolvePageCounts({
    pageLimit: pageCount,
    reportedPages,
    measuredPages: measure ? pagesNeededFor(measure) : null,
    overflowSignal: overflow,
  });
  const stackedPages = counts.visualPages > 1;
  const totalVisualPages = counts.visualPages;
  // 单页的"一页高"：`fitScale` 永远按**一页**算，保证任何一页都能完整落在视口里。
  const contentUnitHeight = stackedPages ? A4_HEIGHT_PX : paperHeight;
  const contentTotalWidth = A4_WIDTH_PX;
  const contentTotalHeight = stackedPages
    ? A4_HEIGHT_PX * totalVisualPages + PAGE_STACK_GAP_PX * (totalVisualPages - 1)
    : paperHeight;
  // 两个夹取，顺序不能反：
  // 1) `maxFitScale` 封顶（大屏允许放大，默认 1）；
  // 2) 可读下限往上抬——**fit 不做吸附**，它必须"恰好装得下"，否则纸比容器宽一像素
  //    就会凭空多出一条横向滚动条。手动 `zoom` 另有一档，同样不许低于下限。
  // 按宽度适应（制作台）时**不看高度**：纸宽恰好等于相框宽，纵向由滚动承接（Q21）。
  const rawFit =
    fitMode === "width"
      ? viewportWidth / contentTotalWidth
      : Math.min(viewportWidth / A4_WIDTH_PX, viewportHeight / contentUnitHeight);
  const fitScale = Math.min(maxFitScale, Math.max(MIN_READABLE_SCALE, rawFit));
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_READABLE_SCALE, fitScale * zoom));
  const viewportHeightForPage = Math.min(contentUnitHeight * fitScale, viewportHeight);
  const scaledWidth = contentTotalWidth * scale;
  const scaledHeight = contentTotalHeight * scale;
  const pagesNeeded = counts.pagesNeeded;
  const overflowAmount = measure ? overflowHeightFor(measure) : 0;
  // 文案在**调用期**取（t() 只能在函数体里求值）；渲染它的 `ResumePreview` 不在本批
  // 清单内，切语言时需由宿主订阅 locale 才会重算。
  //
  // 有报告时按**报告的页数差**说超出量（`pages_needed − 上限`）：同一行里已经写着
  // 「已显示全部 N 页，其中第 M 页起不计入导出」，若这里再报一个浏览器量出来的 3.7 页，
  // 一条提示里就会出现两个互相打架的数字。
  const overflowAmountText =
    counts.overflow && reportedPages && reportedPages > 0
      ? t("preview.geometry.overflowPages", {
          pages: String(counts.pagesNeeded - counts.pageLimit),
        })
      : measure
        ? (() => {
            const ratio = overflowAmount / measure.pageContentHeight;
            return ratio < 1
              ? t("preview.geometry.overflowPercent", {
                  percent: Math.max(1, Math.round(ratio * 100)),
                })
              : t("preview.geometry.overflowPages", { pages: ratio.toFixed(1) });
          })()
        : t("preview.geometry.overflowUnknown");

  return {
    viewportWidth,
    viewportHeight,
    contentUnitHeight,
    contentTotalWidth,
    contentTotalHeight,
    fitScale,
    scale,
    // 只在「确实停在下限上」时为真：放大之后纸不再被下限约束，读数就该回到普通百分比，
    // 否则 100% 也会挂着"已到最小可读缩放"，反而让人以为缩不动。
    clampedToMin: rawFit < MIN_READABLE_SCALE && Math.abs(scale - MIN_READABLE_SCALE) < 1e-9,
    viewportHeightForPage,
    scaledWidth,
    scaledHeight,
    pagesNeeded,
    overflowAmount,
    totalVisualPages,
    overflowPages: counts.overflowPages,
    // 竖排后不再有"页间隙条"：页与页之间是真实的空白 + 每页自己的边框/阴影。
    separatorCount: 0,
    pageGap,
    overflowAmountText,
    // 2026-11-02 起超限的页**会画出来**（带超额角标 + 虚线），不再裁掉；
    // 这个标志只用来选提示文案（"第 M 页起不计入导出"）。
    overflowClipped: counts.overflow,
  };
}
