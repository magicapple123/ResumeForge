// SPDX-License-Identifier: Apache-2.0
/**
 * 暗色下的 PDF 纸面配色（R12 / R22）。
 *
 * ## 为什么反色是一层 CSS 滤镜，而不是逐笔 `ctx.filter`
 *
 * 排查报告给的写法是「渲染前设 `ctx.filter = invert(...)`，包住 `drawImage`」。实测在
 * 本数据集那份 InDesign 导出的简历上不成立：正文段落（透明组／字体回填）与照片都是
 * `render()` 的 promise 之后才落到画布上的，逐笔滤镜漏掉了它们 —— 结果是标题反了、
 * 正文没反，纸面一片黑字看不了。
 *
 * 所以改成**画完整页再套 CSS 滤镜**：晚到的笔画也逃不掉。代价是照片会被一起反色，
 * 于是再画一张"只画图片"的透明画布（pdf.js 的 `operationsFilter`）盖在反色页上，
 * 照片恢复原色。扫描件没有文字层，整页就是一张图，直接不反色、只压暗。
 *
 * ## 纸底为什么是 `#e1e1e1`
 *
 * pdf.js 的 `background` 是画在反色**之前**的：`invert(1)` 会把 `#e1e1e1` 落成
 * `#1e1e1e` 炭灰，正好是暗色纸面的目标值。直接给白色会反成纯黑，和弹层背景糊在一起。
 *
 * ## 打印
 *
 * CSS 滤镜在 `@media print` 里被清掉，所以 `Ctrl+P` 打出来是白纸黑字（反色不再烘进
 * 像素，这一步才真的有效）。
 *
 * 这里只放纯函数：滤镜参数是本模块唯一的"魔法值"，抽出来才能被单测钉住。
 */

/** 暗色下文字页用的反色滤镜（与内部简历 `paperTheme.ts` 同一组参数）。 */
export const PDF_DARK_FILTER = "invert(1) hue-rotate(180deg)";

/** 扫描件在暗色下的压暗系数：能看出是纸，又不至于刺眼。 */
export const SCAN_DIM_BRIGHTNESS = 0.84;

/** 反色后落成 `#1e1e1e` 的"反算色"，只作为 pdf.js 的底色使用。 */
export const DARK_PAPER_HEX = "#e1e1e1";

/** 浅色下的纸底：pdf.js 默认值，显式写出来免得两处各记一半。 */
export const LIGHT_PAPER_HEX = "#ffffff";

/** 一页该怎么画：要不要反色、底色用什么、照片要不要单独盖一层。 */
export interface PdfPaintPlan {
  /** 整页套反色（暗色文字页）。 */
  invert: boolean;
  /** 传给 pdf.js 的底色（暗色用反算色）。 */
  background: string;
  /** 叠在整页 canvas 上的 CSS filter（只给扫描件压暗用）。 */
  canvasFilter: string;
  /** 是否再画一张"只画图片"的透明图层，把照片恢复成原色。 */
  imagesOverlay: boolean;
}

/**
 * 算出这一页的绘制方案。
 *
 * @param isDark 当前是否深色主题（打印时调用方要传 `false`：白纸优先）。
 * @param scanned 这一份原件有没有文字层（`!has_text` = 扫描件，整页就是一张图）。
 */
export function pdfPaintPlan(isDark: boolean, scanned: boolean): PdfPaintPlan {
  if (!isDark) {
    return {
      invert: false,
      background: LIGHT_PAPER_HEX,
      canvasFilter: "none",
      imagesOverlay: false,
    };
  }
  if (scanned) {
    // 不反色：整页本来就是一张图，反色会把纸变成黑块，也和原件的观感对不上。
    return {
      invert: false,
      background: LIGHT_PAPER_HEX,
      canvasFilter: `brightness(${SCAN_DIM_BRIGHTNESS})`,
      imagesOverlay: false,
    };
  }
  return {
    invert: true,
    background: DARK_PAPER_HEX,
    canvasFilter: "none",
    imagesOverlay: true,
  };
}

/**
 * 这份原件是不是扫描件（没有文字层）。
 *
 * 用 `has_text` 而不是"看页面里有没有图片"：后端提取不到文字就是扫描件或纯图片 PDF，
 * 而这个判定在详情里本来就有，不需要再探测一次。
 */
export function isScannedOriginal(hasText: boolean): boolean {
  return !hasText;
}
