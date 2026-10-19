/**
 * 拖动中的一次「实时换位」提交（顺序 + 高度数组同步 splice + FLIP 动画）。
 *
 * 从 `useProfileSectionReorder.ts` 抽出以满足单文件 500 行预算，行为逐字保留。
 *
 * ## 为什么 flushSync 是交换帧对齐的关键
 *
 * store 提交（`commitOrder` → notify → 订阅者重渲）默认在下一帧才把新的 CSS `order`
 * 内联样式写进 DOM，而随后的 `syncDrag` 写入的 transform 是按**新布局**算的——不先
 * 提交就有一帧「旧 order + 新 transform」，被拖分区在交换成功瞬间向上（或向下）跳一个
 * 槽位（与条目路径同款错帧，真机逐帧实测一个槽位高度）。flushSync 让顺序提交同步完成
 * 后再写 transform，同帧生效。
 *
 * 调用点都在原生事件 / scroll / rAF 回调里，不在渲染期；换位受闩锁门控（位移 ≥12px），
 * 频率很低，同步渲染不构成性能问题。
 *
 * ## FLIP
 *
 * 提交前量一次各分区的视觉位置（只挪动两槽之间的邻卡），提交后让邻卡从旧位置 150ms
 * 滑到新位置；被拖卡不参与动画，保持 1:1 跟手。
 */

import type { DragStackGeometry } from "../../components/profile/dragReorder";
import { moveWithin } from "../../components/profile/dragReorder";
import { captureFlipTops, playSwapFlip } from "../../components/profile/swapFlip";
import { flushSync } from "react-dom";
import type { ProfileSectionOrderStore } from "./sectionOrderStore";

export interface LiveSwapParams {
  /** 顺序 + 拖拽态的外部 store（顺序的唯一权威来源）。 */
  store: ProfileSectionOrderStore;
  /** 本次拖拽的栈几何：`heights` 与顺序逐位对齐，换位时同步 splice。 */
  geometry: DragStackGeometry;
  /** 被拖分区的根元素（FLIP 时跳过它，保持跟手）。 */
  draggedElement: HTMLElement | null;
  /** 被拖分区当前下标。 */
  sourceIndex: number;
  /** 目标下标。 */
  targetIndex: number;
}

/** 把被拖分区从 `sourceIndex` 挪到 `targetIndex`；原地不动或越界时整体 no-op。 */
export function commitLiveSwap({
  store,
  geometry,
  draggedElement,
  sourceIndex,
  targetIndex,
}: LiveSwapParams): void {
  const current = store.getOrder();
  const next = moveWithin(current, sourceIndex, targetIndex);
  if (next === current) return;
  // FLIP First：提交前量一次各分区的视觉位置。
  const prevTops = captureFlipTops(document.body, "[data-profile-section-key]");
  geometry.heights = moveWithin(geometry.heights, sourceIndex, targetIndex);
  flushSync(() => {
    store.commitOrder(next);
  });
  // FLIP Last-Invert-Play：邻卡从旧位置滑到新位置。
  playSwapFlip(prevTops, draggedElement);
}
