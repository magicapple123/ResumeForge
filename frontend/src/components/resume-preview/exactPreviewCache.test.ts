// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览缓存：命中 / LRU 顺序 / 容量上限。
 *
 * 这几条都不是"实现细节"：缓存不淘汰 = 拖一次滑块多留一份整 PDF；淘汰顺序错 = 把
 * 用户刚看过的那份扔了、留下更早的；key 混淆 = 换了版式却显示旧图（比慢得多更糟）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreviewCache,
  previewCacheStats,
  readCachedPreview,
  writeCachedPreview,
  type CachedPreview,
} from "./exactPreviewCache";

function shot(pages = 1, bytes = 16): CachedPreview {
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    pages,
    pagesNeeded: pages,
    overflow: false,
  };
}

beforeEach(() => {
  clearPreviewCache();
});

describe("exactPreviewCache", () => {
  it("存进去的原样读出来，元数据不丢", () => {
    writeCachedPreview("k1", { ...shot(2), pagesNeeded: 3, overflow: true });

    const hit = readCachedPreview("k1");
    expect(hit).not.toBeNull();
    expect(hit?.pages).toBe(2);
    expect(hit?.pagesNeeded).toBe(3);
    expect(hit?.overflow).toBe(true);
    expect(readCachedPreview("没有这个 key")).toBeNull();
  });

  it("超过条数上限时淘汰**最久未用**的那一份", () => {
    for (let index = 0; index < 8; index += 1) writeCachedPreview(`k${index}`, shot());
    expect(previewCacheStats().entries).toBe(8);

    // 再用一次 k0：它变成最近使用，于是下一个被淘汰的应该是 k1。
    expect(readCachedPreview("k0")).not.toBeNull();
    writeCachedPreview("k8", shot());

    expect(previewCacheStats().entries).toBe(8);
    expect(readCachedPreview("k0")).not.toBeNull();
    expect(readCachedPreview("k1")).toBeNull();
    expect(readCachedPreview("k8")).not.toBeNull();
  });

  it("同一个 key 覆盖写不会撑大缓存", () => {
    writeCachedPreview("k", shot(1));
    writeCachedPreview("k", shot(2));
    expect(previewCacheStats().entries).toBe(1);
    expect(readCachedPreview("k")?.pages).toBe(2);
  });

  it("总字节超上限时按最久未用回收，但**至少留一份**", () => {
    // 每份 12MB：三份就超过 24MB 上限。
    const big = () => shot(1, 12 * 1024 * 1024);
    writeCachedPreview("a", big());
    writeCachedPreview("b", big());
    writeCachedPreview("c", big());

    const stats = previewCacheStats();
    expect(stats.entries).toBeLessThanOrEqual(2);
    expect(stats.bytes).toBeLessThanOrEqual(24 * 1024 * 1024);
    // 最后写的那份一定还在（否则刚存完就删，等于没缓存）。
    expect(readCachedPreview("c")).not.toBeNull();
  });
});
