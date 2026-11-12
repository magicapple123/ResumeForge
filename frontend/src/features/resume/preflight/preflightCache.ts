// SPDX-License-Identifier: Apache-2.0
/**
 * 统一检查结果的跨页面缓存（22a）：最多 3 份，纯内存，按 `resumeId` 存。
 *
 * 为什么需要：结果的生命周期原本跟着**页面**走（`usePreflight` 的组件 state），退出
 * 制作台就整份丢掉——用户明明刚看完清单，回来还得再点一次「开始检查」。而一次检查要
 * 渲染 PDF、抽文本、跑规则，重跑是最贵的那种"白等"。
 *
 * 为什么按 `resumeId` 而不是按内容指纹存：指纹一变就该**显示旧结果 + 过期提示**，
 * 而不是整份消失（"改一个字就没了"比"多看一眼旧结论"更难受）。所以 `key` 只记录
 * "这份结果当时是按哪一版算的"，读的时候**不用它拒绝**——`usePreflight` 的 `stale`
 * 会把 `resultKey !== currentKey` 表达成「结果基于上一版，重新检查可更新」。
 *
 * 为什么带上 `datasetScope`：数据集 A 与 B 里可能有同 id 的简历，缓存不认数据集就会
 * 把 A 库的检查结果显示给 B 库的同 id 简历（跨库串数据）。
 *
 * 为什么不做持久化（sessionStorage / 后端）：每份结果含整页抽取文本（几十 KB），
 * 且缓存一旦跨会话就可能在版本漂移后误导用户。F5 清空是**有意**的。
 */
import type { PreflightOut } from "./types";

export interface CachedPreflight {
  resumeId: number;
  /** 写缓存时的 `currentKey`（内容指纹 + 版式关键参数）；用于事后算 stale。 */
  key: string;
  /** 写缓存时的数据集身份（`currentDatasetScope()`）；读时不一致直接丢弃。 */
  datasetScope: string | null;
  result: PreflightOut;
}

/** 最多留几份：清单验收的预期行为是"连看 4 份后第 1 份回到空态"。 */
const MAX_ENTRIES = 3;

/** `Map` 的迭代顺序就是插入顺序：淘汰时取第一个 = 最久没写过的。 */
const entries = new Map<number, CachedPreflight>();

/**
 * 读整条缓存（结果 + 写它时的 `key`）。
 *
 * `usePreflight` 需要 `key` 来恢复 `resultKey`（否则 `stale` 恒为 true）；只关心结果的
 * 调用方用下面的 `readPreflightCache`。
 */
export function readPreflightEntry(resumeId: number, scope: string | null): CachedPreflight | null {
  const hit = entries.get(resumeId);
  if (!hit) return null;
  if (hit.datasetScope !== scope) {
    entries.delete(resumeId);
    return null;
  }
  return hit;
}

/**
 * 读一份缓存的结果。
 *
 * `_key` 刻意**不参与匹配**：`key` 不同仍然读回，由 `usePreflight` 的 `stale` 表达
 * "结果基于上一版"。参数保留是为了让调用点的意图完整（"我要的是这一版的结果"），
 * 且将来若要改成"同 key 才算命中"时不必改所有调用点。
 *
 * 数据集身份不一致时删掉这条并返回 null：切库后旧条目留着只会占掉 3 个名额。
 */
export function readPreflightCache(
  resumeId: number,
  _key: string,
  scope: string | null,
): PreflightOut | null {
  return readPreflightEntry(resumeId, scope)?.result ?? null;
}

/** 写一份（同 `resumeId` 覆盖 = 这份简历的最新结果），超过 3 条淘汰最旧的。 */
export function writePreflightCache(entry: CachedPreflight): void {
  entries.delete(entry.resumeId);
  entries.set(entry.resumeId, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** 清掉一份（`clear()` 时）或全部（测试隔离）。 */
export function clearPreflightCache(resumeId?: number): void {
  if (resumeId === undefined) {
    entries.clear();
    return;
  }
  entries.delete(resumeId);
}
