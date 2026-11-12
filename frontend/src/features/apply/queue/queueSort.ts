// SPDX-License-Identifier: Apache-2.0
/**
 * 队列的排序与参考分档位（#14B/#14H）：纯函数，不碰 React，便于单测。
 *
 * 三条约定（都来自详册 #14）：
 * 1. 参考分是**派生值**，「未分析」（`null`）永远排在最后，且档位是 `none`
 *    ——不把"没有信息"渲染成"0 分"；
 * 2. 默认排序保持后端给的顺序（= 入队顺序），点列头才切到参考分；
 * 3. 排序是**稳定**的：同分之间保持原顺序，用户不会看到表格自己跳来跳去。
 */
import type { ApplyQueueItem } from "../../../types";

/** 参考分档位：`<60` 低、`60–79` 中、`≥80` 高，没有分数是 `none`。 */
export type QueueScoreBand = "none" | "low" | "mid" | "high";

export function scoreBand(score: number | null | undefined): QueueScoreBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  if (score >= 80) return "high";
  if (score >= 60) return "mid";
  return "low";
}

/** 排序口径：`joined` = 后端给的入队顺序，`score` = 参考分（高的在前）。 */
export type QueueSortKey = "joined" | "score";

/** 下一个排序口径：列头点击在两个口径之间来回切。 */
export function nextSortKey(current: QueueSortKey): QueueSortKey {
  return current === "joined" ? "score" : "joined";
}

/**
 * 按口径排序并返回**新数组**（不改入参）。
 *
 * `joined` 直接返回原顺序的浅拷贝；`score` 用带下标的稳定排序，`null` / 非数字垫底。
 */
export function sortQueueItems(
  items: readonly ApplyQueueItem[],
  key: QueueSortKey,
): ApplyQueueItem[] {
  if (key === "joined") return [...items];
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftScore = Number.isFinite(left.item.match_score)
        ? (left.item.match_score as number)
        : Number.NEGATIVE_INFINITY;
      const rightScore = Number.isFinite(right.item.match_score)
        ? (right.item.match_score as number)
        : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

/** 取一段文本的首行（招呼语在表格里只放得下一行，全文走 Tooltip）。 */
export function firstLine(text: string): string {
  const [head = ""] = text.split(String.fromCharCode(10));
  return head;
}
