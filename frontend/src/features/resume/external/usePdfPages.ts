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

/** 把某一页画进 canvas；`box` 来自 {@link usePdfPages}。 */
export async function drawPdfPage(
  canvas: HTMLCanvasElement,
  doc: PdfDocument,
  box: PdfPageBox,
): Promise<void> {
  const proxy = await doc.getPage(box.page);
  try {
    const base = proxy.getViewport({ scale: 1 });
    if (!(base.width > 0)) return;
    const viewport = proxy.getViewport({ scale: (box.width / base.width) * RENDER_RATIO });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    // v6 推荐传 `canvas` 而不是 `canvasContext`：底色由 pdfjs 自己铺。
    await proxy.render({ canvas, viewport, background: "#ffffff" }).promise;
  } finally {
    proxy.cleanup();
  }
}
