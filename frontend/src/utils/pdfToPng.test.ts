// SPDX-License-Identifier: Apache-2.0
/**
 * `renderPdfToPng` 的单测：**不真跑渲染**（jsdom 没有 canvas，真 pdfjs 也起不来 worker），
 * 只钉住编排逻辑——页序、scale 折算、资源释放，以及"传进来的字节被复制一份"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** 每页的原始尺寸（scale=1 时的 pt 宽高），长度即页数。 */
  pageSizes: [] as { width: number; height: number }[],
  /** `getViewport` 收到的所有 scale（每页两次：1 与目标 scale）。 */
  viewportScales: [] as number[],
  /** `render()` 收到的参数摘要（底色 + 画布尺寸）。 */
  renderCalls: [] as { background?: string; width: number; height: number }[],
  /** `getDocument` 收到的 data 引用。 */
  receivedData: [] as Uint8Array[],
  cleanup: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (options: { data: Uint8Array }) => {
    state.receivedData.push(options.data);
    const pageCount = state.pageSizes.length;
    return {
      promise: Promise.resolve({
        numPages: pageCount,
        getPage: async (pageNumber: number) => {
          const size = state.pageSizes[pageNumber - 1];
          return {
            getViewport: ({ scale }: { scale: number }) => {
              state.viewportScales.push(scale);
              return { width: size.width * scale, height: size.height * scale };
            },
            render: (params: {
              canvas: HTMLCanvasElement;
              background?: string;
              viewport: { width: number; height: number };
            }) => {
              state.renderCalls.push({
                background: params.background,
                width: params.canvas.width,
                height: params.canvas.height,
              });
              return { promise: Promise.resolve() };
            },
            cleanup: state.cleanup,
          };
        },
      }),
      // v6：销毁入口在 loadingTask 上，`PDFDocumentProxy` 没有 destroy。
      destroy: state.destroy,
    };
  },
}));

// worker 用 `?url` 引入（Vite 打进 dist/assets）；测试里换成固定串，避免真去解析 1MB 的 worker。
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker-url" }));

import * as pdfjs from "pdfjs-dist";
import { DEFAULT_TARGET_WIDTH, renderPdfToPng } from "./pdfToPng";

const A4 = { width: 595.28, height: 841.89 };

/** 一份"字节"占位物：内容无所谓，pdfjs 已被 mock。 */
function fakePdf(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
}

beforeEach(() => {
  state.pageSizes = [A4];
  state.viewportScales = [];
  state.renderCalls = [];
  state.receivedData = [];
  state.cleanup.mockReset();
  state.destroy.mockReset();
  // jsdom 没有 canvas 实现：`toBlob` 直接回一个 PNG blob。
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value: (callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderPdfToPng", () => {
  it("单页 PDF 返回 1 项，序号从 1 开始，尺寸按 300dpi 折算", async () => {
    const pages = await renderPdfToPng(fakePdf());

    expect(pages).toHaveLength(1);
    expect(pages[0].index).toBe(1);
    expect(pages[0].blob.type).toBe("image/png");
    // A4 宽 595.28pt → 2480px（300dpi）；高按同一 scale 等比放大。
    expect(pages[0].width).toBe(DEFAULT_TARGET_WIDTH);
    expect(pages[0].height).toBe(Math.round(A4.height * (DEFAULT_TARGET_WIDTH / A4.width)));
  });

  it("多页 PDF 返回 N 项且 index 递增（1..N）", async () => {
    state.pageSizes = [A4, A4, { width: 612, height: 792 }];

    const pages = await renderPdfToPng(fakePdf());

    expect(pages.map((page) => page.index)).toEqual([1, 2, 3]);
    // 每页都按同一个目标像素宽折算：Letter 页不会因为原始 pt 不同而变窄。
    expect(pages.map((page) => page.width)).toEqual([
      DEFAULT_TARGET_WIDTH,
      DEFAULT_TARGET_WIDTH,
      DEFAULT_TARGET_WIDTH,
    ]);
  });

  it("targetWidth 决定 scale（先取 scale=1 的原尺寸，再折算）", async () => {
    await renderPdfToPng(fakePdf(), { targetWidth: 1240 });

    expect(state.viewportScales[0]).toBe(1);
    expect(state.viewportScales[1]).toBeCloseTo(1240 / A4.width, 6);
    expect(state.renderCalls[0].width).toBe(1240);
  });

  it("非法 targetWidth 回落到默认值，超界值被夹住", async () => {
    await renderPdfToPng(fakePdf(), { targetWidth: 0 });
    expect(state.viewportScales[1]).toBeCloseTo(DEFAULT_TARGET_WIDTH / A4.width, 6);

    state.viewportScales = [];
    await renderPdfToPng(fakePdf(), { targetWidth: 100_000 });
    // 上限 4960（A4 600dpi）。
    expect(state.viewportScales[1]).toBeCloseTo(4960 / A4.width, 6);
  });

  it("画布铺白底：不铺底就是一张透明 PNG，投递平台会显示成黑底", async () => {
    await renderPdfToPng(fakePdf());

    expect(state.renderCalls[0].background).toBe("#ffffff");
  });

  it("每页 cleanup、最后 destroy，避免多页文档把位图缓存堆在内存里", async () => {
    state.pageSizes = [A4, A4];

    await renderPdfToPng(fakePdf());

    expect(state.cleanup).toHaveBeenCalledTimes(2);
    expect(state.destroy).toHaveBeenCalledTimes(1);
  });

  it("把字节复制一份再交给 pdfjs（原数组会被 transfer 走，不能直接复用调用方的）", async () => {
    const input = fakePdf();

    await renderPdfToPng(input);

    expect(state.receivedData).toHaveLength(1);
    expect(state.receivedData[0]).not.toBe(input);
    expect(Array.from(state.receivedData[0])).toEqual(Array.from(input));
  });

  it("worker 由打包产物提供（`?url`），不走 CDN", () => {
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("pdf-worker-url");
  });
});
