// SPDX-License-Identifier: Apache-2.0
/**
 * 页眉字段的"位置组 + 组内顺序"（#10 基本信息 chip 化的纯函数部分）。
 *
 * ## 为什么页眉需要它
 *
 * 页眉 item 的位置是 `HeaderPlacement`（name / name_meta / subtitle / contact / photo /
 * hidden），纸面上同一个位置组内按 `document.header.items` 的数组顺序排版。chip 化之后
 * 拖拽 / 方向键要回答的正是这两个问题：**落到哪个位置组**、**落在组内第几位**。
 *
 * 条目（`ResumeItem`）那边有一套 `drag.ts`（Placement 六组）；页眉的位置枚举不同
 * （多 name/name_meta/subtitle/photo，少 title/lead/trail），因此单独一份实现而不是硬套。
 *
 * 与 `mutations.ts` 同一套约定：找不到就返回**原引用**（`===` 判"没改成"），不抛错。
 */
import type { MessageKey } from "../../../i18n";
import type { HeaderItem, HeaderPlacement, ResumeDocument } from "../../../types/resumeDocument";

/** 页眉位置在界面上的文案（面板分组标题、位置下拉、结构树同源）。 */
export const HEADER_PLACEMENT_LABEL_KEYS: Record<HeaderPlacement, MessageKey> = {
  name: "document.headerPlacement.name",
  name_meta: "document.headerPlacement.name_meta",
  subtitle: "document.headerPlacement.subtitle",
  contact: "document.headerPlacement.contact",
  photo: "document.headerPlacement.photo",
  hidden: "document.placement.hidden",
};

/** 自定义页眉字段的 key 前缀（与目录里的内置 key 区分开：目录永远不含它）。 */
export const CUSTOM_HEADER_KEY_PREFIX = "custom_";

/** 这条页眉字段是不是用户自己加的（没有目录规格：标签只在本地，纸面只印值）。 */
export function isCustomHeaderItem(item: HeaderItem): boolean {
  return item.key.startsWith(CUSTOM_HEADER_KEY_PREFIX);
}

/** 页眉位置组的渲染 / 遍历顺序（与 types 的 HEADER_PLACEMENTS 同序，hidden 收尾）。 */
export const HEADER_PLACEMENT_ORDER: readonly HeaderPlacement[] = [
  "name",
  "name_meta",
  "subtitle",
  "contact",
  "photo",
  "hidden",
];

/** 一个"页眉位置组内的槽位"：位置 + 组内下标。 */
export interface HeaderSlot {
  placement: HeaderPlacement;
  index: number;
}

export type HeaderDragDirection = "up" | "down" | "left" | "right";

/** 某个位置组里的 item（顺序即纸面顺序）。 */
export function headerGroupOf(
  items: readonly HeaderItem[],
  placement: HeaderPlacement,
): HeaderItem[] {
  return items.filter((item) => item.placement === placement);
}

/** 当前槽位：找不到（item 不在列表里）返回 null。 */
export function headerSlotOf(items: readonly HeaderItem[], item: HeaderItem): HeaderSlot | null {
  const group = headerGroupOf(items, item.placement);
  const index = group.findIndex((candidate) => candidate.id === item.id);
  return index < 0 ? null : { placement: item.placement, index };
}

/**
 * 方向键的目标槽位。
 *
 * - ↑ / ↓：同一位置组内上 / 下移一位，到边界返回 null（界面给"已经到边界"提示）；
 * - ← / →：在位置组之间循环切换，组内下标夹到目标组末尾。
 */
export function keyboardHeaderMoveTarget(
  items: readonly HeaderItem[],
  slot: HeaderSlot,
  direction: HeaderDragDirection,
): HeaderSlot | null {
  if (direction === "left" || direction === "right") {
    const current = HEADER_PLACEMENT_ORDER.indexOf(slot.placement);
    if (current < 0) return null;
    const delta = direction === "left" ? -1 : 1;
    const total = HEADER_PLACEMENT_ORDER.length;
    const nextPlacement = HEADER_PLACEMENT_ORDER[(current + delta + total) % total];
    const size = headerGroupOf(items, nextPlacement).length;
    return {
      placement: nextPlacement,
      index: Math.min(slot.index, Math.max(size, 0)),
    };
  }
  const group = headerGroupOf(items, slot.placement);
  const target = slot.index + (direction === "up" ? -1 : 1);
  if (target < 0 || target >= group.length) return null;
  return { placement: slot.placement, index: target };
}

/**
 * 把一个页眉字段移动到目标槽位（改位置 + 改顺序，一次写完）。
 *
 * 顺序口径：`document.header.items` 是唯一真相，组内顺序 = 该数组里的相对顺序。
 * 因此"移动"= 从数组里摘掉 + 按目标组的位置重新插入：
 * - `index` 超出该组现有长度 → 追加到组末尾（组为空则追加到数组末尾）；
 * - 否则插到该组第 `index` 个元素之前。
 */
export function moveHeaderItem(
  document: ResumeDocument,
  itemId: string,
  target: HeaderSlot,
): ResumeDocument {
  const items = document.header.items;
  const from = items.findIndex((item) => item.id === itemId);
  if (from < 0) return document;
  const moved: HeaderItem = { ...items[from], placement: target.placement };
  const rest = items.filter((_, index) => index !== from);
  const groupPositions: number[] = [];
  rest.forEach((item, index) => {
    if (item.placement === target.placement) groupPositions.push(index);
  });
  const insertAt =
    groupPositions.length === 0 || target.index >= groupPositions.length
      ? groupPositions.length === 0
        ? rest.length
        : groupPositions[groupPositions.length - 1] + 1
      : groupPositions[Math.max(0, target.index)];
  const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  // 只按 id + placement 判定"没变化"：位置与顺序都没动时返回原引用，宿主不会多记一条历史。
  const unchanged =
    next.length === items.length &&
    next.every(
      (item, index) => item.id === items[index]?.id && item.placement === items[index]?.placement,
    );
  if (unchanged) return document;
  return { ...document, header: { ...document.header, items: next } } as ResumeDocument;
}

/** 页眉里的照片字段（值是 data URL 的那条）；没有返回 null。 */
export function headerPhotoItem(document: ResumeDocument): HeaderItem | null {
  return document.header.items.find((item) => item.key === "photo") ?? null;
}

/** 照片字段的值是不是 data URL（旧数据可能是空串或残缺值，不猜）。 */
export function isPhotoDataUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^data:image\/[a-z0-9.+-]+;/i.test(value.trim());
}
