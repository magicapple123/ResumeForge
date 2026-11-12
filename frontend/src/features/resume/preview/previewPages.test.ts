// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的纯函数层：高度算式与地址拼装。
 *
 * 这两条都不是"实现细节"：
 * - 相框高度一旦算错，页面不是被裁掉一截就是底下多出一片空白；
 * - 图片地址一旦拼错，界面只剩一排破图图标。
 *
 * 单独成文件而不是塞进面板测试：这里不需要 DOM，算式本身就该能脱离浏览器验证。
 */
import { describe, expect, it } from "vitest";
import {
  previewPageHeight,
  previewPageImageUrl,
  previewPagesHeight,
  previewPdfUrl,
  previewWidthBucket,
  type PreviewPageImage,
} from "./previewPages";

/** 一张 A4 位图（1800 × 2546 是 `900 × 1 × 2` 那档的实际输出量级）。 */
function page(index: number, width = 1800, height = 2546): PreviewPageImage {
  return { index, width, height };
}

describe("previewPages", () => {
  it("单页高度按位图自己的宽高比折算，不套 A4 常数", () => {
    // 900 CSS 宽 × (2546 / 1800) = 1273
    expect(previewPageHeight(page(0), 900)).toBe(1273);
    // 换一种纸张比例（例如 Letter 的 8.5:11）：折算必须跟着位图走。
    expect(previewPageHeight(page(0, 1700, 2200), 850)).toBe(1100);
    // 还没量到宽度 / 坏数据：0 而不是 NaN（NaN 会把整个相框高度算成 NaN）。
    expect(previewPageHeight(page(0), 0)).toBe(0);
    expect(previewPageHeight(page(0, 0, 0), 900)).toBe(0);
  });

  it("整叠高度 = 页高之和 + 页间距 × (页数 − 1)", () => {
    const pages = [page(0), page(1), page(2)];
    expect(previewPagesHeight(pages, 900, 8)).toBe(1273 * 3 + 8 * 2);
    // 单页没有页间距；空列表是 0（不是 -gap）。
    expect(previewPagesHeight([page(0)], 900, 8)).toBe(1273);
    expect(previewPagesHeight([], 900, 8)).toBe(0);
  });

  it("图片地址按 token + 页号拼，与后端路由逐字一致", () => {
    expect(previewPageImageUrl(7, "abc123", 2)).toBe("/api/resumes/7/preview-pages/abc123/2.webp");
    // 「在新标签打开」指向服务端的同一份 PDF（图片化之后页面上没有 blob 可开了）。
    expect(previewPdfUrl(7, "abc123")).toBe("/api/resumes/7/preview-pages/abc123/document.pdf");
  });

  it("宽度桶按 64px 一档（与后端 WIDTH_BUCKET_PX 同值），量不到宽度时回 0", () => {
    expect(previewWidthBucket(0)).toBe(0);
    // 桶宽从 128 改成 64（#23 P3）：这两条断言在两种桶宽下都必须成立，**不许改松**。
    expect(previewWidthBucket(900)).toBe(previewWidthBucket(910));
    expect(previewWidthBucket(900)).not.toBe(previewWidthBucket(1100));

    // 下面**写死绝对值**：改了 `PREVIEW_WIDTH_BUCKET_PX`（例如退回 16）必须立刻变红，
    // 而"两个值相等"这类相对断言在 16/24/32/48 下全都能过，等于没守住任何东西。
    // 64 一档时：900 / 912 / 913 都在第 14 档，959 与 960 都在第 15 档。
    expect(previewWidthBucket(900)).toBe(14);
    expect(previewWidthBucket(912)).toBe(14);
    expect(previewWidthBucket(913)).toBe(14);
    expect(previewWidthBucket(959)).toBe(15);
    expect(previewWidthBucket(960)).toBe(15);
    expect(previewWidthBucket(1024)).toBe(16);

    // **注意 959 与 960 是同一个桶**，这是 `round` 的构造决定的：前端换档点在
    // 32 + 64k（992、1056…），后端 `ceil` 的换档点在 64k + 1（961、1025…）。两侧
    // 不必逐值相同，理由见 `previewWidthBucket` 的注释。真正会换档的是这一对：
    expect(previewWidthBucket(991)).toBe(15);
    expect(previewWidthBucket(992)).toBe(16);
    expect(previewWidthBucket(991)).not.toBe(previewWidthBucket(992));
  });
});
