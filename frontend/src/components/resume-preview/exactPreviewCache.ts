// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览结果缓存（模块级 LRU）：同一份 PDF 只排一次。
 *
 * 一份精确预览要服务端用 fpdf2 重排一遍（本机实测 ~450ms，其中字体解析 ~310ms），
 * 而下面三种动作问的都是**同一份**字节：
 *
 * - 草稿 ↔ 精确来回切（一个参数都没改）；
 * - 打开 / 关闭「查看大图」（另一个面板实例，同一组参数）；
 * - 把滑块拖回刚才那个值。
 *
 * 不缓存的话，每切一次就白等一次服务端重排——2026-10-21 用户反馈的正是第一条：
 * "跳到草稿再跳回精确，什么都没改却还要重排一次"。
 *
 * 这里只存 **Blob**，不存 objectURL：URL 的生命周期归面板（只有它知道哪一层正在显示、
 * 哪一层在预加载），缓存只回答"这份字节算过没有"。面板的双缓冲与 URL 释放逻辑因此
 * 一行都不用改，`卸载时释放 objectURL` 这条既有约束继续成立。
 *
 * key 由调用方给（内容签名 + 整组版式参数）：内容或参数一变 key 就变，所以**不需要
 * 失效逻辑**。容量按条数与总字节双限，淘汰最久未用的一份。
 */

export interface CachedPreview {
  blob: Blob;
  pages: number | null;
  pagesNeeded: number | null;
  overflow: boolean;
}

/** 最多留几份：一轮"改字号 → 改行距 → 改回来"最多用到 3~4 份。 */
const MAX_ENTRIES = 8;
/** 总字节上限：单份约 100–400KB，8 份仍在 3MB 内；字体/照片多的简历也不会失控。 */
const MAX_BYTES = 24 * 1024 * 1024;

/** `Map` 的迭代顺序就是插入顺序：删了再插 = 移到队尾（最近使用）。 */
const entries = new Map<string, CachedPreview>();

function totalBytes(): number {
  let total = 0;
  for (const entry of entries.values()) total += entry.blob.size;
  return total;
}

/** 读一份，并把它标成"最近用过"；没有就返回 null。 */
export function readCachedPreview(key: string): CachedPreview | null {
  const hit = entries.get(key);
  if (!hit) return null;
  entries.delete(key);
  entries.set(key, hit);
  return hit;
}

/** 存一份（同 key 覆盖），随后按条数 / 总字节淘汰最久未用的。 */
export function writeCachedPreview(key: string, value: CachedPreview): void {
  entries.delete(key);
  entries.set(key, value);
  // 至少留一份：哪怕它自己就超过字节上限，也不该刚存完就删掉。
  while (entries.size > MAX_ENTRIES || (entries.size > 1 && totalBytes() > MAX_BYTES)) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** 整份清掉：测试之间隔离用，也让"换数据集"将来有明确的出口。 */
export function clearPreviewCache(): void {
  entries.clear();
}

/** 可观察量：条数与总字节（调试与测试断言用）。 */
export function previewCacheStats(): { entries: number; bytes: number } {
  return { entries: entries.size, bytes: totalBytes() };
}
