// SPDX-License-Identifier: Apache-2.0
/**
 * 把 PDF 逐页画成 PNG（补充格式：投递平台只收图片时用）。
 *
 * 为什么从 PDF 转、而不是再排一套版：ATS 能解析的是 PDF，所以导出管线只保留**一份**排版
 * 产物。图片若另起一套 HTML→canvas 的排版，就等于给"预览 / 导出"的分页差异又加一个来源
 * （见 `ExactPreviewPanel` 的注释）。这里只做**像素化**：同一份 PDF 字节，逐页光栅化，
 * 页数与断页位置天然与用户下载的 PDF 完全一致。
 *
 * 分辨率口径：默认 A4 宽 2480px（300dpi）。招聘平台的"图片格式"要求多在 200–300dpi 之间，
 * 300dpi 是印刷/投递的通用上限——再高只是文件更大，OCR 识别率不再提升。
 */
import * as pdfjs from "pdfjs-dist";
// `?url` 让 Vite 把 worker 打进 dist/assets：桌面端离线、CSP 不允许 CDN，不能用 unpkg。
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 默认目标宽度（A4 300dpi）。 */
export const DEFAULT_TARGET_WIDTH = 2480;

/** 允许的宽度区间：低于 400 看不清正文，高于 4960（A4 600dpi）只会让文件翻倍。 */
const MIN_TARGET_WIDTH = 400;
const MAX_TARGET_WIDTH = 4960;

/** 一页渲染结果。 */
export interface RenderedPage {
  /** 页码，**从 1 开始**（与"第 N 页"、zip 里的 `-N` 后缀同一个编号）。 */
  index: number;
  /** PNG 字节。 */
  blob: Blob;
  /** 实际画布宽（px），= round(页面宽 × scale)。 */
  width: number;
  /** 实际画布高（px）。 */
  height: number;
}

/** 渲染选项。 */
export interface RenderPdfOptions {
  /** 目标像素宽度；缺省 {@link DEFAULT_TARGET_WIDTH}（A4 300dpi）。越界值会被夹到合理区间。 */
  targetWidth?: number;
  /** 画布底色。缺省白色——PDF 页画布本身是透明的，不铺底就成了"透明 PNG"。 */
  background?: string;
}

/** 把调用方传入的宽度夹成可用的整数；非法值回落到默认值。 */
function normalizeTargetWidth(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TARGET_WIDTH;
  }
  return Math.min(MAX_TARGET_WIDTH, Math.max(MIN_TARGET_WIDTH, Math.round(value)));
}

/** canvas → PNG Blob（`toBlob` 是回调式，包一层 Promise）。 */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("浏览器未能把画布转成 PNG（画布可能过大）"));
      }
    }, "image/png");
  });
}

/**
 * 把一份 PDF 逐页渲染成 PNG。
 *
 * 单页与多页走同一条路径：多页只是返回数组更长，由调用方决定是否打包
 * （见 `utils/pngExport.ts`）。
 *
 * @param data PDF 字节。内部**复制一份**再交给 pdfjs：`getDocument` 会把 buffer
 *   转移（transfer）给 worker，原数组会被 detach，调用方之后再用就拿到空数组了。
 * @param options 见 {@link RenderPdfOptions}。
 * @returns 按页码升序的渲染结果（至少一页，否则抛错）。
 */
export async function renderPdfToPng(
  data: Uint8Array,
  options: RenderPdfOptions = {},
): Promise<RenderedPage[]> {
  const targetWidth = normalizeTargetWidth(options.targetWidth);
  const background = options.background ?? "#ffffff";
  // 释放走 loadingTask（v6 的 `PDFDocumentProxy` 上没有 destroy，只有 task 有）：
  // 它同时断开 worker，多导几份才不会攒下一堆 pdfjs worker。
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });

  try {
    const doc = await loadingTask.promise;
    const rendered: RenderedPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        // 先按 scale=1 取原尺寸，再折算到目标像素宽：不同 PDF 的页面尺寸可以不一样
        // （A4 / Letter / 自定义），用固定 scale 会让它们宽度不一。
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));

        // v6 推荐传 `canvas` 而不是 `canvasContext`：底色由 pdfjs 自己铺，
        // 省掉"先 fillRect 再渲染"的顺序依赖。
        await page.render({ canvas, viewport, background }).promise;

        rendered.push({
          index: pageNumber,
          blob: await canvasToPngBlob(canvas),
          width: canvas.width,
          height: canvas.height,
        });
      } finally {
        // 每页画完立刻释放 pdfjs 侧的位图缓存，多页文档才不会一路堆到几百 MB。
        page.cleanup();
      }
    }

    if (rendered.length === 0) {
      throw new Error("这份 PDF 里没有可渲染的页面");
    }
    return rendered;
  } finally {
    await loadingTask.destroy();
  }
}
