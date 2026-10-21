// SPDX-License-Identifier: Apache-2.0
/** `pngExport` 的单测：主名推导 + 单页 png / 多页 zip 的分流（光栅化本身被 mock）。 */
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const pngMocks = vi.hoisted(() => ({ renderPdfToPng: vi.fn() }));

vi.mock("./pdfToPng", () => pngMocks);

import { exportPdfBlobAsPng, pdfFilenameStem, runPngExport } from "./pngExport";

/** 一份占位 PDF blob。 */
function pdfBlob(): Blob {
  return new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
}

describe("pdfFilenameStem", () => {
  it("去掉扩展名，保留服务端给的 <姓名>-<意向>-<日期>", () => {
    expect(pdfFilenameStem("张三-后端工程师-20261021.pdf")).toBe("张三-后端工程师-20261021");
  });

  it("没有扩展名时原样返回", () => {
    expect(pdfFilenameStem("简历")).toBe("简历");
  });

  it("把文件名非法字符换成连字符（Windows 更严，按 Windows 收）", () => {
    expect(pdfFilenameStem('a/b:c*d?"e".pdf')).toBe("a-b-c-d--e-");
  });

  it("空文件名回落到「简历」", () => {
    expect(pdfFilenameStem("")).toBe("简历");
    expect(pdfFilenameStem("   ")).toBe("简历");
  });
});

describe("exportPdfBlobAsPng", () => {
  it("单页直接给 png", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([
      { index: 1, blob: new Blob(["p1"], { type: "image/png" }), width: 2480, height: 3508 },
    ]);

    const result = await exportPdfBlobAsPng(pdfBlob(), "简历.pdf");

    expect(result.filename).toBe("简历.png");
    expect(result.pages).toBe(1);
    expect(result.blob.type).toBe("image/png");
  });

  it("多页打成一个 zip，条目按页序命名", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([
      { index: 1, blob: new Blob(["p1"], { type: "image/png" }), width: 2480, height: 3508 },
      { index: 2, blob: new Blob(["p2"], { type: "image/png" }), width: 2480, height: 3508 },
    ]);

    const result = await exportPdfBlobAsPng(pdfBlob(), "简历.pdf");

    expect(result.filename).toBe("简历.zip");
    expect(result.pages).toBe(2);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["简历-1.png", "简历-2.png"]);
  });

  it("把渲染选项透传给 renderPdfToPng", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([
      { index: 1, blob: new Blob(["p1"], { type: "image/png" }), width: 1240, height: 1754 },
    ]);

    await exportPdfBlobAsPng(pdfBlob(), "简历.pdf", { targetWidth: 1240 });

    expect(pngMocks.renderPdfToPng).toHaveBeenCalledWith(expect.any(Uint8Array), {
      targetWidth: 1240,
    });
  });
});

describe("runPngExport", () => {
  it("请求方放弃（null）时原样返回 cancelled，不做渲染", async () => {
    const requestPdf = vi.fn().mockResolvedValue(null);

    const outcome = await runPngExport(requestPdf);

    expect(outcome).toEqual({ status: "cancelled" });
    expect(pngMocks.renderPdfToPng).not.toHaveBeenCalled();
  });

  it("成功时交回可下载的 blob 与页数", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([
      { index: 1, blob: new Blob(["p1"], { type: "image/png" }), width: 2480, height: 3508 },
    ]);

    const outcome = await runPngExport(() =>
      Promise.resolve({ blob: pdfBlob(), filename: "简历.pdf" }),
    );

    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.filename).toBe("简历.png");
      expect(outcome.pages).toBe(1);
    }
  });

  it("转换失败时抛「PDF 已生成，图片转换失败」（PDF 那一步其实是成功的）", async () => {
    pngMocks.renderPdfToPng.mockRejectedValue(new Error("画布过大"));

    await expect(
      runPngExport(() => Promise.resolve({ blob: pdfBlob(), filename: "简历.pdf" })),
    ).rejects.toThrow("PDF 已生成，图片转换失败：画布过大");
  });
});
