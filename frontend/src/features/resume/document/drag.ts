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
 * - TextItem 没有可选位置，← / → 返回 null；↑ / ↓ 仍可在正文组内换序（问题 12）。
 */
import type { Placement, ResumeItem } from "../../../types/resumeDocument";
import {
  allowedPlacementsForItem,
  canDropIntoZone,
  canPlaceItem,
  canReorderWithin,
  getItemPlacement,
  zoneOfPlacement,
} from "./placement";

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
  // ↑ / ↓ 只换同组顺序，不要求"能换位置"：正文块（text）的允许位置是空数组，但它在正文组里
  // 同样要能用方向键前后挪（问题 12）。
  if (direction === "up" || direction === "down") {
    const group = placementGroup(items, slot.placement);
    const targetIndex = slot.index + (direction === "up" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= group.length) return null;
    return { placement: slot.placement, index: targetIndex };
  }
  // ← / → 才是"换位置"，这里要看位置白名单；正文块没有可选位置 → null。
  const allowed = allowedPlacementsForItem(item);
  if (allowed.length === 0) return null;
  const currentIndex = allowed.indexOf(slot.placement);
  if (currentIndex < 0) return null;
  const delta = direction === "left" ? -1 : 1;
  const nextPlacement = allowed[(currentIndex + delta + allowed.length) % allowed.length];
  const groupSize = placementGroup(items, nextPlacement).length;
  return { placement: nextPlacement, index: Math.min(slot.index, Math.max(groupSize, 0)) };
}

/** 当前槽位（键盘移动后重算用）：找不到返回 null。 */
export function slotOf(items: readonly ResumeItem[], item: ResumeItem): DragSlot | null {
  const placement = getItemPlacement(item);
  const group = placementGroup(items, placement);
  const index = group.findIndex((candidate) => candidate.id === item.id);
  return index < 0 ? null : { placement, index };
}

// ────────────────────────────────────────────────────────────────────────────
// 鼠标拖放的落点语义（问题 13）
// ────────────────────────────────────────────────────────────────────────────

/** 落点侧：插到目标 chip 的前面 / 后面（由光标与 chip 中线的左右关系决定）。 */
export type DropSide = "before" | "after";

/** 一次落点判定的结果。 */
export interface DropResolution {
  /**
   * 交给 `moveItem` 的组内下标。
   *
   * ⚠️ 语义是**摘除拖拽项之后**的下标（`moveItem` 的既定契约，键盘移动也依赖它）。
   * 鼠标看到的是"可见下标"，同组且被拖项排在目标之前时要补回 1 位——这个换算**只在这里做一次**，
   * 调用方（dragover / drop）必须共用本函数的输出，不允许各算一份：
   * 两份实现一定会漂移，表现就是"线画在右边、落点却在左边"。
   */
  toIndex: number;
  /** 插完不动（落点就是它原来的槽位）——不画插入线、光标禁止、松手给「已经在这个位置」。 */
  noop: boolean;
}

/**
 * 由「目标组 + 落点侧」算出 `moveItem` 的下标，并判出这次落点是不是 no-op。
 *
 * @param groupIds 目标位置组的 item id（**顺序即纸面顺序**，必须已完成拖拽项摘除之后的下标语义）
 * @param draggedId 被拖动的 item id；不在该组里（跨组 / 跨条目）时按"插入"处理，永不 no-op
 * @param targetIndex 目标 chip 在组内的**可见**下标
 * @param side 落在目标 chip 的左半边（before）还是右半边（after）
 */
export function resolveDropIndex(
  groupIds: readonly string[],
  draggedId: string,
  targetIndex: number,
  side: DropSide,
): DropResolution {
  const draggedIndex = groupIds.indexOf(draggedId);
  if (draggedIndex >= 0 && draggedIndex === targetIndex) {
    // 落在**自己身上**：插到自己前面/后面都等于原地——把自己摘掉之后，那个"前/后"就不存在了。
    // 不特判的话"拖到自己的右半边"会算出 toIndex = 下标 + 1 并画出一条假的插入线。
    return { toIndex: draggedIndex, noop: true };
  }
  // 同组且被拖项排在目标之前：摘掉自己后，目标的下标会前移 1 位。
  const shift = draggedIndex >= 0 && draggedIndex < targetIndex ? 1 : 0;
  const targetAfterRemoval = targetIndex - shift;
  const toIndex = side === "after" ? targetAfterRemoval + 1 : targetAfterRemoval;
  return { toIndex, noop: draggedIndex >= 0 && toIndex === draggedIndex };
}

/**
 * 落点被拒的原因。四种原因各用各的文案，合并成一句"不能放到这里"用户就不知道该怎么改：
 *
 * - `invalid`：这个 item 类型本身不允许这个位置（列表字段进标题行等）；
 * - `illegalTitle`：跨方框，且目标是标题/元信息或正文前/后灰字区；
 * - `illegalBody`：跨方框，且目标是正文块区；
 * - `samePosition`：位置合法，但插完还是原地（no-op）。
 */
export type DropRejectReason = "invalid" | "illegalTitle" | "illegalBody" | "samePosition";

/**
 * 一次落点在**位置层面**是否被拒（与"插完会不会动"无关）。
 *
 * `readOnly` 为真时组内换序也不允许（只读文档不接拖拽）。
 * 返回 null = 位置合法，是否真的换位还要再看 `resolveDropIndex().noop`。
 */
export function dropRejectReason(
  item: ResumeItem,
  placement: Placement,
  readOnly = false,
): DropRejectReason | null {
  // 「组内换序」先判：正文块的 `canPlaceItem` 恒为 false，但同组往前挪一格、以及从隐藏区
  // 拖回正文区都只要求可写（问题 12）。落到当前组之外的判断维持原样。
  if (canReorderWithin(item, placement, readOnly)) return null;
  if (!canPlaceItem(item, placement)) return "invalid";
  if (!canDropIntoZone(item, placement)) {
    // 「正文块区」与「标题/元信息 + 灰字区」的拒绝出口不一样，文案必须分开。
    return zoneOfPlacement(placement) === "body" ? "illegalBody" : "illegalTitle";
  }
  return null;
}
