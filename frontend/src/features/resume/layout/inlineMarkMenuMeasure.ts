// SPDX-License-Identifier: Apache-2.0
/**
 * I-11：右键菜单**测量重试**的判定（从 `InlineMarkContextMenu` 拆出来的纯函数）。
 *
 * 为什么要单独一处：重试上限是"失败时不许把菜单永久藏起来"的唯一保险，而它埋在
 * `useLayoutEffect` 里时只能靠时序去测（jsdom 里 portal 总会挂上，那条分支根本走不到）。
 * 拆成纯函数后，"第几次放弃"就是一条可以逐值断言的规则。
 *
 * 为什么上限是 30：≈500ms（16ms × 30）。再久用户会以为"点了没反应"；再短会在低端机
 * 首次挂载时就误判失败、把菜单钉在兜底位置上。
 */

/** 重试帧数上限（≈500ms @60fps）。 */
export const MEASURE_RETRY_LIMIT = 30;

/** 放弃后的兜底尺寸：只用于算出"能看"的落点，不改变弹层真实尺寸。 */
export const FALLBACK_MENU_SIZE = { width: 180, height: 220 } as const;

export type MeasureDecision =
  { kind: "retry" } | { kind: "fallback"; size: { width: number; height: number } };

/**
 * 本轮测量没拿到节点时的下一步。
 *
 * @param attempts 已经尝试过的次数（调用方在每次"没节点"时先 +1 再问）
 */
export function nextMeasureAttempt(attempts: number): MeasureDecision {
  return attempts >= MEASURE_RETRY_LIMIT
    ? { kind: "fallback", size: FALLBACK_MENU_SIZE }
    : { kind: "retry" };
}
