// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览缓存：命中 / 覆盖 / LRU 顺序 / 容量上限。
 *
 * 这几条都不是"实现细节"：缓存不淘汰 = 拖一次滑块就多留一份清单永远不放；淘汰顺序错 =
 * 把用户刚看过的那份扔了、留下更早的；key 混淆 = 换了版式却显示旧图（比慢得多更糟）。
 *
 * 2026-11（P3-2）起缓存的是**清单**（token + 逐页尺寸），不再存 PDF 字节：图片由服务端的
 * `GET …/{token}/{index}.webp` 提供，浏览器 HTTP 缓存再兜一层，前端因此不需要管 objectURL。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreviewCache,
  previewCacheStats,
  readCachedPreview,
  writeCachedPreview,
  type CachedPreviewPages,
} from "./exactPreviewCache";

function meta(pageCount = 1): CachedPreviewPages {
  return {
    token: `token-${pageCount}`,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      index,
      width: 1800,
      height: 2546,
    })),
    pagesNeeded: pageCount,
    overflow: false,
  };
}

beforeEach(() => {
  clearPreviewCache();
});

describe("exactPreviewCache", () => {
  it("存进去的原样读出来，页数与结论都不丢", () => {
    writeCachedPreview("k1", { ...meta(2), pagesNeeded: 3, overflow: true });

    const hit = readCachedPreview("k1");
    expect(hit).not.toBeNull();
    expect(hit?.pages).toHaveLength(2);
    expect(hit?.pagesNeeded).toBe(3);
    expect(hit?.overflow).toBe(true);
    expect(readCachedPreview("没有这个 key")).toBeNull();
  });

  it("超过条数上限时淘汰**最久未用**的那一份", () => {
    for (let index = 0; index < 8; index += 1) writeCachedPreview(`k${index}`, meta());
    expect(previewCacheStats().entries).toBe(8);

    // 再用一次 k0：它变成最近使用，于是下一个被淘汰的应该是 k1。
    expect(readCachedPreview("k0")).not.toBeNull();
    writeCachedPreview("k8", meta());

    expect(previewCacheStats().entries).toBe(8);
    expect(readCachedPreview("k0")).not.toBeNull();
    expect(readCachedPreview("k1")).toBeNull();
    expect(readCachedPreview("k8")).not.toBeNull();
  });

  it("同一个 key 覆盖写不会撑大缓存", () => {
    writeCachedPreview("k", meta(1));
    writeCachedPreview("k", meta(2));
    expect(previewCacheStats().entries).toBe(1);
    expect(readCachedPreview("k")?.pages).toHaveLength(2);
  });

  it("统计口径给出条数与总页数（调试与容量判断都用它）", () => {
    writeCachedPreview("a", meta(1));
    writeCachedPreview("b", meta(3));
    expect(previewCacheStats()).toEqual({ entries: 2, pages: 4 });
  });
});
