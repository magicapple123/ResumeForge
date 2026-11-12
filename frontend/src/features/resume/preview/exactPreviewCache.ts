// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览结果缓存（模块级 LRU）：同一份版式只问服务端一次。
 *
 * 一份精确预览要服务端重排一遍 PDF 再光栅化成位图（本机数百毫秒），而下面三种动作问的
 * 都是**同一版**：
 *
 * - 草稿 ↔ 精确来回切（一个参数都没改）；
 * - 打开 / 关闭「简历制作台」（另一个面板实例，同一组参数）；
 * - 把滑块拖回刚才那个值。
 *
 * 不缓存的话，每切一次就白等一次排版——2026-10-21 用户反馈的正是第一条：
 * "跳到草稿再跳回精确，什么都没改却还要重排一次"。
 *
 * 2026-11 起缓存的是**清单**（token + 逐页尺寸），不再存 PDF 字节：图片由服务端的
 * `GET …/{token}/{index}.webp` 提供，地址完全可以重算，浏览器 HTTP 缓存还会再兜一层
 * （服务端对 token 地址回 `immutable`）。所以这里既不需要 `Blob`，也不需要 objectURL
 * 生命周期——面板因此少了一整类"忘释放就泄漏"的坑。
 *
 * key 由调用方给（内容签名 + 整组版式参数 + 宽高桶）：内容或参数一变 key 就变，所以
 * **不需要失效逻辑**。容量按条数上限淘汰最久未用的一份。
 */
import type { PreviewPagesMeta } from "./previewPages";

/** 缓存里存的那一份：清单本体，不含 `key`（它就是字典的键）与任何 URL。 */
export type CachedPreviewPages = PreviewPagesMeta;

/** 最多留几份：一轮"改字号 → 改行距 → 改回来"最多用到 3~4 份。 */
const MAX_ENTRIES = 8;

/** `Map` 的迭代顺序就是插入顺序：删了再插 = 移到队尾（最近使用）。 */
const entries = new Map<string, CachedPreviewPages>();

/** 读一份，并把它标成"最近用过"；没有就返回 null。 */
export function readCachedPreview(key: string): CachedPreviewPages | null {
  const hit = entries.get(key);
  if (!hit) return null;
  entries.delete(key);
  entries.set(key, hit);
  return hit;
}

/** 存一份（同 key 覆盖），随后按条数淘汰最久未用的。 */
export function writeCachedPreview(key: string, value: CachedPreviewPages): void {
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** 整份清掉：测试之间隔离用，也让"换数据集"将来有明确的出口。 */
export function clearPreviewCache(): void {
  entries.clear();
}

/** 可观察量：条数与总页数（调试与测试断言用）。 */
export function previewCacheStats(): { entries: number; pages: number } {
  let pages: number = 0;
  for (const entry of entries.values()) pages += entry.pages.length;
  return { entries: entries.size, pages };
}
