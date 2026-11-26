// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历编辑页的 pdf.js 渲染（#5 的前端半边）。
 *
 * 三件事，都只服务于一件事：**把某一页画到 canvas 上，好让人点中要改的那一段**。
 *
 * 1. `usePdfPages(fileUrl)`：取原件字节 → `getDocument` → 逐页算出显示尺寸（只算尺寸，
 *    不画）。渲染交给组件在挂上 canvas 之后调 `drawPdfPage`，这样 React 不需要为了
 *    "等 ref 出现"再多一层状态。
 * 2. `drawPdfPage`：按 `box.width` 折算 scale 后画一页；内部按 2 倍像素画再由 CSS 缩回，
 *    高分屏上文字才不糊。
 * 3. worker 用 `?url` 从依赖里本地打包 —— 桌面端离线、CSP 不允许 CDN，**不能**指向 unpkg。
 *
 * **不做的事**：不在这里做"新文字回填预览"。v1 的预览就是服务端改完的文件本身，
 * 前端不再排第二套版（两套排版必然不一致，见 issue-ledger 第五条的拍板）。
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { PDF_DARK_FILTER } from "./pdfDark";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 页面在屏幕上的目标宽度（CSS px）。热区按百分比定位，所以改这个值只影响清晰度。 */
export const PAGE_WIDTH_PX = 720;

/** 实际渲染像素比：2 倍画、CSS 缩回，高分屏不糊。 */
const RENDER_RATIO = 2;

/** 一页的显示尺寸（CSS px，`page` 是 1 基页码）。 */
export interface PdfPageBox {
  page: number;
  width: number;
  height: number;
}

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

export interface PdfPagesResult {
  status: "loading" | "ready" | "error";
  /** 失败原因（取原生错误的 message；没有就一句通用说明）。 */
  error: string;
  pages: PdfPageBox[];
  /** 已加载的文档；`ready` 之前为 null。渲染某一页时传回给 `drawPdfPage`。 */
  document: PdfDocument | null;
}

/**
 * 加载原件并算出逐页显示尺寸。
 *
 * `fileUrl` 变化（换了一份简历、或编辑后 `file_id` 变了）就重新加载：编辑产物是**新
 * `user_file`**，URL 里带版本号，所以"应用后刷新预览"对这里就是换一个 URL。
 */
export function usePdfPages(fileUrl: string): PdfPagesResult {
  const [result, setResult] = useState<PdfPagesResult>({
    status: "loading",
    error: "",
    pages: [],
    document: null,
  });

  useEffect(() => {
    let cancelled = false;
    // 释放走 loadingTask（v6 的 `PDFDocumentProxy` 上没有 destroy）：它同时断开 worker，
    // 反复打开不同简历时才不会攒下一堆 worker。
    const task = pdfjs.getDocument({ url: fileUrl });

    void (async () => {
      try {
        const doc = await task.promise;
        const pages: PdfPageBox[] = [];
        for (let page = 1; page <= doc.numPages; page += 1) {
          const proxy = await doc.getPage(page);
          try {
            // 先按 scale=1 取原尺寸，再折算到目标宽：不同 PDF 的纸张尺寸可以不一样
            // （A4 / Letter / 自定义），固定 scale 会让它们宽度不一，热区百分比也会错。
            const base = proxy.getViewport({ scale: 1 });
            const height = base.width > 0 ? (base.height / base.width) * PAGE_WIDTH_PX : PAGE_WIDTH_PX;
            pages.push({ page, width: PAGE_WIDTH_PX, height: Math.round(height) });
          } finally {
            proxy.cleanup();
          }
        }
        if (cancelled) {
          await task.destroy();
          return;
        }
        setResult({ status: "ready", error: "", pages, document: doc });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          status: "error",
          error: error instanceof Error ? error.message : t("externalEdit.previewFailed"),
          pages: [],
          document: null,
        });
      }
    })();

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [fileUrl]);

  return result;
}

/**
 * 一页怎么画：底色 + 是否只画图片 + 是否整页反色。
 *
 * 反色放在**渲染完成之后**做（把画好的画布整体再过一遍滤镜）：pdf.js 有些绘制
 * （图片解码、字体回填）会在 `render()` 的 promise 之后才落到画布上，逐笔设
 * `ctx.filter` 会漏掉它们（实测：标题反了、正文没反，纸面一片黑字看不了）。
 * 整页再过一遍滤镜，晚到的笔画也一起被反色；照片则靠另一张"只画图片"的画布盖回去。
 */
export interface PdfPaintOptions {
  /** 纸底：浅色 `#fff`，暗色用反算色 `#e1e1e1`。 */
  background: string;
  /** 画完把整页反色（暗色文字页）。 */
  invert?: boolean;
}

/** 默认配方（浅色）：白底、不反色。 */
const LIGHT_PAINT: PdfPaintOptions = { background: "#ffffff", invert: false };

/**
 * 收集一组操作码（`OPS` 是 pdf.js 的导出常量；测试里那份 mock 没有它，所以取不到就跳过，
 * 不要在校验/渲染时炸掉整页）。
 */
function opSet(names: readonly string[]): Set<number> {
  let ops: Record<string, number> | undefined;
  try {
    // `try` 是因为测试里那份 pdfjs 的 mock 没有 `OPS`，访问未知导出会直接抛错。
    ops = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS;
  } catch {
    ops = undefined;
  }
  const values: number[] = [];
  if (ops) {
    for (const name of names) {
      const value = ops[name];
      if (typeof value === "number") values.push(value);
    }
  }
  return new Set(values);
}

/** 只影响状态（变换 / 裁剪 / 透明组），自己不落任何像素 —— 叠层必须保留它们。 */
const STATE_OPS = opSet([
  "save",
  "restore",
  "transform",
  "setTransform",
  "setGState",
  "setFillAlpha",
  "setStrokeAlpha",
  "setLineWidth",
  "setLineCap",
  "setLineJoin",
  "setDash",
  "setHScale",
  "clip",
  "rect",
  "rectangle",
  "moveTo",
  "lineTo",
  "curveTo",
  "curveTo2",
  "curveTo3",
  "closePath",
  "beginGroup",
  "endGroup",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
]);

/** 真正"画一张位图"的操作：照片与扫描件整页图都在这几档里。 */
const IMAGE_OPS = opSet([
  "paintImageXObject",
  "paintImageXObjectRepeat",
  "paintInlineImageXObject",
  "paintInlineImageXObjectGroup",
  "paintImageMaskXObject",
  "paintImageMaskXObjectGroup",
  "paintImageMaskXObjectRepeat",
  "paintSolidColorImageMask",
]);

/**
 * 把某一页画进 canvas；`box` 来自 {@link usePdfPages}。
 *
 * `paint.invert`：画完把整页反色（先等两帧，等 pdf.js 那些"晚到"的笔画落定）。
 */
export async function drawPdfPage(
  canvas: HTMLCanvasElement,
  doc: PdfDocument,
  box: PdfPageBox,
  paint: PdfPaintOptions = LIGHT_PAINT,
): Promise<void> {
  const proxy = await doc.getPage(box.page);
  try {
    const base = proxy.getViewport({ scale: 1 });
    if (!(base.width > 0)) return;
    const viewport = proxy.getViewport({ scale: (box.width / base.width) * RENDER_RATIO });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await proxy.render({ canvas, viewport, background: paint.background }).promise;
    if (paint.invert) await invertCanvas(canvas);
  } finally {
    proxy.cleanup();
  }
}

/**
 * 把"只画图片"的那一层叠回反色页（照片恢复原色）。
 *
 * 为什么不加第二个 `<canvas>` 元素：pdf.js 一定会先铺白底（`background || "#ffffff"`，
 * 透明底传不进去），叠一个元素等于在反色页上盖一张白纸，把正文全糊住（实测）。所以
 * 图片那一遍画到**离屏画布**，量出非白像素的外接矩形，只把那一块贴回底层画布。
 *
 * 代价：同一页有多张图时会按并集抠出一整块（图之间可能夹一条白边）。简历里通常只有一张
 * 证件照，取外接矩形足够；逐张抠图要 pdf.js 的 `recordImages`，那套 API 还不稳定。
 */
export async function drawPdfImagesOver(
  canvas: HTMLCanvasElement,
  doc: PdfDocument,
  box: PdfPageBox,
): Promise<void> {
  const proxy = await doc.getPage(box.page);
  try {
    const base = proxy.getViewport({ scale: 1 });
    if (!(base.width > 0)) return;
    const viewport = proxy.getViewport({ scale: (box.width / base.width) * RENDER_RATIO });
    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    await proxy.render({
      canvas: offscreen,
      viewport,
      background: "#ffffff",
      // 只跑图片那几档：文字/图形已经在底层画过了。
      operationsFilter: (index: number, operatorList: { fnArray: number[] }) => {
        const fn = operatorList.fnArray[index];
        return IMAGE_OPS.has(fn) || STATE_OPS.has(fn);
      },
    }).promise;
    copyImageBox(offscreen, canvas);
  } finally {
    proxy.cleanup();
  }
}

/**
 * 把离屏画布上的"非白像素外接矩形"贴回目标画布。
 *
 * 白底是 pdf.js 铺的，不是图的一部分：只拷矩形，矩形外的像素（反色后的正文）保持不动。
 */
function copyImageBox(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
  const sourceContext = source.getContext("2d");
  const targetContext = target.getContext("2d");
  if (sourceContext === null || targetContext === null) return;
  const { width, height } = source;
  if (width <= 0 || height <= 0) return;
  const pixels = sourceContext.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const index = rowStart + x * 4;
      if (pixels[index] === 255 && pixels[index + 1] === 255 && pixels[index + 2] === 255) {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || maxY < 0) return;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  targetContext.drawImage(source, minX, minY, boxWidth, boxHeight, minX, minY, boxWidth, boxHeight);
}

/** 等两帧：pdf.js 的部分绘制（图片解码、字体回填）在 promise 之后才落到画布上。 */
function nextFrames(count = 2): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 把画布上的内容整体反色（一次 `drawImage` 走滤镜，而不是逐笔）。
 *
 * 先拷到离屏画布再画回来：同一个 canvas 既当源又当目标，各浏览器行为不一致。
 */
async function invertCanvas(canvas: HTMLCanvasElement): Promise<void> {
  await nextFrames();
  const context = canvas.getContext("2d");
  if (context === null) return;
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  const snapshotContext = snapshot.getContext("2d");
  if (snapshotContext === null) return;
  snapshotContext.drawImage(canvas, 0, 0);
  context.save();
  context.filter = PDF_DARK_FILTER;
  context.drawImage(snapshot, 0, 0);
  context.restore();
}
