// SPDX-License-Identifier: Apache-2.0
/**
 * 拖拽的**键盘等价物**（纯函数）：方向键改位置/顺序，Enter 确认，Esc 取消。
 *
 * 鼠标拖拽（HTML5 DnD）与键盘走同一套位置规则（`allowedPlacementsForItem`），
 * 非法目标由界面给可读提示，不静默失败。
 *
 * 键盘模型：
 * - ↑ / ↓：在同一位置组内上/下移一位；到边界返回 null（界面提示「已经到边界了」）；
 * - ← / →：按允许位置列表循环切换位置（组内下标夹到末尾）；
 * - TextItem 不参与拖拽（没有 placement），返回 null。
 */
import type { Placement, ResumeItem } from "../../types/resumeDocument";
import { allowedPlacementsForItem, getItemPlacement } from "./placement";

export type DragDirection = "up" | "down" | "left" | "right";

/** 一个"位置组内的槽位"：placement + 组内下标。 */
export interface DragSlot {
  placement: Placement;
  /** 组内下标（0 起）；null = 追加到组末尾。 */
  index: number;
}

/** 某位置组在条目里的 item 列表（顺序即纸面顺序）。 */
export function placementGroup(items: readonly ResumeItem[], placement: Placement): ResumeItem[] {
  return items.filter((item) => getItemPlacement(item) === placement);
}

/** 位置分组表：`placement → items`。 */
export type PlacementGroups = Record<Placement, ResumeItem[]>;

/**
 * 一次遍历把条目拆成全部位置组（R-30）。
 *
 * 条目卡以前对 6 个位置组各 `filter` 一遍（每次渲染 6 遍 190 项），再加上各组的计数
 * 又各 filter 一遍。这里一次建成表，渲染期只查表——分组结果与 `placementGroup` 逐项一致，
 * `placementGroup` 保留给单点调用（拖拽落点判定）。
 */
export function groupByPlacement(items: readonly ResumeItem[]): PlacementGroups {
  const groups: PlacementGroups = {
    title: [],
    meta: [],
    lead: [],
    body: [],
    trail: [],
    hidden: [],
  };
  for (const item of items) groups[getItemPlacement(item)].push(item);
  return groups;
}

/**
 * 计算一次方向键移动的目标槽位；不能移动返回 null。
 *
 * @param items 条目内的 items（调用方传当前文档的实时值）
 * @param item 被拿起的 item
 * @param slot 它当前的槽位
 * @param direction 方向键
 */
export function keyboardMoveTarget(
  items: readonly ResumeItem[],
  item: ResumeItem,
  slot: DragSlot,
  direction: DragDirection,
): DragSlot | null {
  const allowed = allowedPlacementsForItem(item);
  if (allowed.length === 0) return null;
  if (direction === "left" || direction === "right") {
    const currentIndex = allowed.indexOf(slot.placement);
    if (currentIndex < 0) return null;
    const delta = direction === "left" ? -1 : 1;
    const nextPlacement = allowed[(currentIndex + delta + allowed.length) % allowed.length];
    const groupSize = placementGroup(items, nextPlacement).length;
    return { placement: nextPlacement, index: Math.min(slot.index, Math.max(groupSize, 0)) };
  }
  const group = placementGroup(items, slot.placement);
  const targetIndex = slot.index + (direction === "up" ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= group.length) return null;
  return { placement: slot.placement, index: targetIndex };
}

/** 当前槽位（键盘移动后重算用）：找不到返回 null。 */
export function slotOf(items: readonly ResumeItem[], item: ResumeItem): DragSlot | null {
  const placement = getItemPlacement(item);
  const group = placementGroup(items, placement);
  const index = group.findIndex((candidate) => candidate.id === item.id);
  return index < 0 ? null : { placement, index };
}
