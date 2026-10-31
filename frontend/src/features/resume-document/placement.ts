// SPDX-License-Identifier: Apache-2.0
/**
 * item 的位置与顺序操作（纯函数，不可变）。
 *
 * ## 位置规则（哪些 item 能放在哪）
 *
 * | item 类型 | 允许的位置 | 理由 |
 * |---|---|---|
 * | field | title / meta / lead / trail / body / hidden | 六个抽屉都行 |
 * | list | lead / trail / hidden | 列表是灰色短字段；放头部会撑爆标题行 |
 * | authors | lead / trail / hidden | 作者列表是灰色短字段（论文 / 专利 trail） |
 * | text | 不参与位置拖拽（只有 hidden 开关） | 正文块不是"字段" |
 *
 * 非法目标**静默返回原文档引用**（`=== before` 是调用方判断"没动"的依据），
 * 界面上必须据此给可读提示，不能假装成功。
 *
 * ## 顺序
 *
 * `items` 是一条有序列表；同一 placement 内的相对顺序就是纸面顺序。跨位置移动 = 从原位置
 * 摘掉 + 插到目标位置组内的指定下标（不传下标 = 追加到该组末尾）。
 */
import type {
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../types/resumeDocument";
import { locatePath } from "./paths";

const ALL_PLACEMENTS: readonly Placement[] = ["title", "meta", "lead", "body", "trail", "hidden"];

/** item 当前在哪个位置（TextItem 没有 placement，落 body / hidden 两个抽屉）。 */
export function getItemPlacement(item: ResumeItem): Placement {
  return item.kind === "text" ? (item.hidden ? "hidden" : "body") : item.placement;
}

/** 这个 item 能放的位置列表（TextItem 返回空数组：它只能切换显示/隐藏）。 */
export function allowedPlacementsForItem(item: ResumeItem): readonly Placement[] {
  switch (item.kind) {
    case "field":
      return ALL_PLACEMENTS;
    case "list":
    case "authors":
      return ["lead", "trail", "hidden"];
    case "text":
    default:
      return [];
  }
}

export function canPlaceItem(item: ResumeItem, placement: Placement): boolean {
  return allowedPlacementsForItem(item).includes(placement);
}

/** 把 item 的 placement 改成目标值；TextItem 只处理 hidden 开关，其余类型返回原引用。 */
export function withItemPlacement(item: ResumeItem, placement: Placement): ResumeItem {
  if (item.kind === "text") {
    if (placement !== "body" && placement !== "hidden") return item;
    const hidden = placement === "hidden";
    return item.hidden === hidden ? item : ({ ...item, hidden } as ResumeItem);
  }
  if (item.placement === placement) return item;
  // 拖到「隐藏」分组 = 隐藏；记下来源位置，拖回/点显示时恢复。
  // 拖到任何非隐藏分组 = 显式改位置，旧的来源位置不再有效。
  return {
    ...item,
    placement,
    hidden_from: placement === "hidden" ? item.placement : null,
  } as ResumeItem;
}

export interface MoveItemTarget {
  /** 目标位置；缺省 = 保持当前位置（只调顺序）。 */
  placement?: Placement;
  /** 目标位置组内的下标；缺省 = 追加到组末尾。 */
  toIndex?: number;
}

function replaceEntry(
  document: ResumeDocument,
  sectionIndex: number,
  entryIndex: number,
  entry: ResumeEntry,
): ResumeDocument {
  const section = document.sections[sectionIndex];
  const entries = section.entries.slice();
  entries[entryIndex] = entry;
  const sections = document.sections.slice();
  sections[sectionIndex] = { ...section, entries };
  return { ...document, sections } as ResumeDocument;
}

/**
 * 移动一条 item（改位置 / 改同组顺序）。
 *
 * 找不到路径、item 是 TextItem、目标位置非法时返回**原文档引用**。
 */
export function moveItem(
  document: ResumeDocument,
  path: string,
  target: MoveItemTarget = {},
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const { item, itemIndex, entry, entryIndex, sectionIndex } = located;
  if (item.kind === "text") return document;
  const currentPlacement = getItemPlacement(item);
  const nextPlacement = target.placement ?? currentPlacement;
  if (!canPlaceItem(item, nextPlacement)) return document;

  const remaining = entry.items.slice();
  remaining.splice(itemIndex, 1);
  const moved = withItemPlacement(item, nextPlacement);

  // 目标位置组在"摘掉之后"的数组里的下标：插入点取该组第 toIndex 个元素之前。
  const groupIndexes = remaining.flatMap((candidate, index) =>
    getItemPlacement(candidate) === nextPlacement ? [index] : [],
  );
  const insertAt = groupIndexes[target.toIndex ?? groupIndexes.length] ?? remaining.length;
  remaining.splice(insertAt, 0, moved);
  return replaceEntry(document, sectionIndex, entryIndex, { ...entry, items: remaining });
}

/** 改位置（顺序追加到目标组末尾）；语义与 `moveItem(doc, path, {placement})` 相同。 */
export function setPlacement(
  document: ResumeDocument,
  path: string,
  placement: Placement,
): ResumeDocument {
  return moveItem(document, path, { placement });
}

/**
 * 在同一位置组内上/下移一位（`delta` = -1 / 1）。
 *
 * 到边界返回原文档引用（界面提示「已经到边界了」），不循环、不跨位置——
 * 跨位置是 drag / `setPlacement` 的职责，方向键上下不替用户做位置决定。
 */
export function reorderItems(
  document: ResumeDocument,
  path: string,
  delta: number,
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const placement = getItemPlacement(located.item);
  const groupIndexes = located.entry.items.flatMap((candidate, index) =>
    getItemPlacement(candidate) === placement ? [index] : [],
  );
  const positionInGroup = groupIndexes.findIndex((index) => index === located.itemIndex);
  const targetInGroup = positionInGroup + delta;
  if (positionInGroup < 0 || targetInGroup < 0 || targetInGroup >= groupIndexes.length) {
    return document;
  }
  return moveItem(document, path, { toIndex: targetInGroup });
}
