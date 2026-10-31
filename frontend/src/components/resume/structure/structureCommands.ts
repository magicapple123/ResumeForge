// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板 → 文档写操作（全部委托 `features/resume-document` 的不可变实现）。
 *
 * 面板自己**不**改文档：这里把"用户拖了哪一行、放到哪一行旁边"翻译成一条命令，
 * 返回新文档 + 该选中哪一行。返回原文档引用 = 这次操作无效（越界 / 跨条目 / 锁住），
 * 面板据此给可读提示而不是假装成功。
 *
 * 条目内 item 的跨位置移动由 `placement.moveItem` 负责（toIndex 是**目标位置组内**的下标）；
 * 条目排序 / 复制 / 隐藏 / 锁定由 `entries.*` 负责；页眉字段只支持显示/隐藏（顺序由
 * 字段目录决定，不做自由排序）。
 */
import type { Placement, ResumeDocument } from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import {
  copyEntry,
  moveEntry,
  toggleEntryHidden,
  toggleLock,
  type EntryLockKind,
} from "../../../features/resume-document/entries";
import {
  getItemPlacement,
  moveItem,
  reorderItems,
  setPlacement,
} from "../../../features/resume-document/placement";
import { updateHeaderItem } from "../../../features/resume-document/mutations";
import { locatePath } from "../../../features/resume-document/paths";

export interface StructureCommandResult {
  document: ResumeDocument;
  /** 操作成功后建议选中的路径（复制条目后选中副本）。 */
  selectPath?: string;
  /** 操作是否改变了文档（false 时面板给"不能放这里 / 已到边界"提示）。 */
  changed: boolean;
}

function unchanged(document: ResumeDocument): StructureCommandResult {
  return { document, changed: false };
}

/** 切换条目 / item 的显示与隐藏。 */
export function toggleNodeHidden(
  document: ResumeDocument,
  node: StructureNode,
): StructureCommandResult {
  if (node.kind === "entry" && node.path) {
    const next = toggleEntryHidden(document, node.path);
    return next === document ? unchanged(document) : { document: next, changed: true };
  }
  if (node.kind === "item" && node.path) {
    if (node.key.startsWith("header.")) {
      const headerItem = document.header.items.find((item) => item.id === node.itemId);
      if (!headerItem) return unchanged(document);
      const placement = headerItem.placement === "hidden" ? "contact" : "hidden";
      const next = updateHeaderItem(document, node.path, { placement });
      return next === document ? unchanged(document) : { document: next, changed: true };
    }
    const located = locatePath(document, node.path);
    if (!located || located.kind !== "item") return unchanged(document);
    if (located.item.kind === "text") {
      // 正文块不是字段：直接改 hidden（mutations.toggleItemHidden 已处理两种类型）。
      const next = toggleItemHiddenSafe(document, node.path);
      return next === document ? unchanged(document) : { document: next, changed: true };
    }
    const next = setPlacement(
      document,
      node.path,
      located.item.placement === "hidden" ? "trail" : "hidden",
    );
    return next === document ? unchanged(document) : { document: next, changed: true };
  }
  return unchanged(document);
}

/**
 * 正文块的隐藏走 `mutations.toggleItemHidden`；为保持本模块只依赖少数入口，
 * 这里用"把 hidden 取反"的等价写法（与 mutations 的语义一致：text 只切 hidden 布尔）。
 */
function toggleItemHiddenSafe(document: ResumeDocument, path: string): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item" || located.item.kind !== "text") return document;
  const items = located.entry.items.slice();
  items[located.itemIndex] = { ...located.item, hidden: !located.item.hidden };
  const entries = located.section.entries.slice();
  entries[located.entryIndex] = { ...located.entry, items };
  const sections = document.sections.slice();
  sections[located.sectionIndex] = { ...located.section, entries };
  return { ...document, sections } as ResumeDocument;
}

/** 切换条目的"锁内容 / 锁排版"（页眉与字段没有锁）。 */
export function toggleNodeLock(
  document: ResumeDocument,
  node: StructureNode,
  lock: EntryLockKind,
): StructureCommandResult {
  if (node.kind !== "entry" || !node.path) return unchanged(document);
  const next = toggleLock(document, node.path, lock);
  return next === document ? unchanged(document) : { document: next, changed: true };
}

/** 复制条目（身份全新），并把选择落到副本上。 */
export function duplicateEntry(
  document: ResumeDocument,
  node: StructureNode,
): StructureCommandResult {
  if (node.kind !== "entry" || !node.path || !node.sectionKey) return unchanged(document);
  const result = copyEntry(document, node.path);
  if (!result.entryId) return unchanged(document);
  return {
    document: result.document,
    selectPath: `${node.sectionKey}.${result.entryId}`,
    changed: true,
  };
}

/** 条目上移/下移一位；到边界返回原引用。 */
export function moveEntryOneStep(
  document: ResumeDocument,
  node: StructureNode,
  delta: -1 | 1,
): StructureCommandResult {
  if (node.kind !== "entry" || !node.path) return unchanged(document);
  const next = moveEntry(document, node.path, delta === -1 ? "up" : "down");
  return next === document ? unchanged(document) : { document: next, changed: true };
}

/** item 在当前所在位置组内上移/下移一位；到边界返回原引用。 */
export function moveItemOneStep(
  document: ResumeDocument,
  node: StructureNode,
  delta: -1 | 1,
): StructureCommandResult {
  if (node.kind !== "item" || !node.path) return unchanged(document);
  const next = reorderItems(document, node.path, delta);
  return next === document ? unchanged(document) : { document: next, changed: true };
}

/** 把一个 item 移到另一个位置分组（跨组移动 = 改 placement + 顺序）。 */
export function moveItemToPlacement(
  document: ResumeDocument,
  node: StructureNode,
  placement: Placement,
): StructureCommandResult {
  if (node.kind !== "item" || !node.path) return unchanged(document);
  const next = setPlacement(document, node.path, placement);
  return next === document ? unchanged(document) : { document: next, changed: true };
}

export type DropSide = "before" | "after" | "inside";

/** 一次拖拽落点能产出的操作；`null` = 不能放在这里。 */
export type DropIntent =
  | { kind: "move-item"; path: string; placement: Placement; toIndex?: number }
  | { kind: "move-entry"; path: string; toIndex: number }
  | { kind: "reorder-header" }
  | null;

/**
 * 计算 item 在目标位置组里的插入下标。
 *
 * `toIndex` 是**摘掉被拖 item 之后**的目标组内下标（`placement.moveItem` 的约定）。
 * 先排除自己再找目标：否则"把第 1 条拖到第 3 条后面"会少算一位。
 */
export function itemDropIndex(
  entryItems: readonly { id: string; kind: string; placement?: Placement }[],
  dragItemId: string,
  targetPlacement: Placement,
  targetItemId: string | null,
  side: DropSide,
): number {
  const peers = entryItems.filter((item) => {
    if (item.id === dragItemId) return false;
    if (item.kind === "text") return targetPlacement === "body" || targetPlacement === "hidden";
    return item.placement === targetPlacement;
  });
  if (!targetItemId) return peers.length;
  const targetIndex = peers.findIndex((item) => item.id === targetItemId);
  if (targetIndex < 0) return peers.length;
  return side === "after" ? targetIndex + 1 : targetIndex;
}

/**
 * 拖拽落点 → 命令。只接受三种目标：
 *
 * 1. item 拖到同一条目的另一个 item 上（before/after）：同组换序或跨组换位置；
 * 2. item 拖到同一条目的位置分组行上（inside）：追加到该组末尾；
 * 3. entry 拖到同板块的另一个 entry 上（before/after）：条目排序。
 *
 * 其余（跨条目拖 item、拖 header、跨板块拖 entry）返回 `null`：结构面板据此显示
 * 「这个位置不能放」——不静默失败，也不做计划外的跨条目搬字段。
 */
export function resolveDropIntent(
  document: ResumeDocument,
  drag: StructureNode,
  target: StructureNode,
  side: DropSide,
): DropIntent {
  if (drag.kind === "item") {
    if (!drag.path || !drag.entryId) return null;
    if (drag.key.startsWith("header.")) return null;
    // 目标：同一条目的分组行或字段行
    const targetEntryId =
      target.kind === "group" || target.kind === "item" ? target.entryId : undefined;
    if (!targetEntryId || targetEntryId !== drag.entryId) return null;
    const located = locatePath(document, drag.path);
    if (!located || located.kind !== "item") return null;
    const items = located.entry.items;
    if (target.kind === "group") {
      if (!target.placement) return null;
      return {
        kind: "move-item",
        path: drag.path,
        placement: target.placement,
        toIndex: itemDropIndex(items, drag.itemId ?? "", target.placement, null, "inside"),
      };
    }
    if (target.kind === "item" && target.placement && target.itemId) {
      return {
        kind: "move-item",
        path: drag.path,
        placement: target.placement,
        toIndex: itemDropIndex(items, drag.itemId ?? "", target.placement, target.itemId, side),
      };
    }
    return null;
  }
  if (drag.kind === "entry") {
    if (!drag.path || !target.sectionKey || target.sectionKey !== drag.sectionKey) return null;
    if (target.kind === "section") {
      const section = document.sections.find((candidate) => candidate.key === drag.sectionKey);
      if (!section) return null;
      return { kind: "move-entry", path: drag.path, toIndex: section.entries.length - 1 };
    }
    if (target.kind !== "entry" || !target.path) return null;
    const section = document.sections.find((candidate) => candidate.key === drag.sectionKey);
    if (!section) return null;
    const peers = section.entries.filter((entry) => entry.id !== drag.entryId);
    const targetIndex = peers.findIndex((entry) => entry.id === target.entryId);
    if (targetIndex < 0) return null;
    return {
      kind: "move-entry",
      path: drag.path,
      toIndex: side === "after" ? targetIndex + 1 : targetIndex,
    };
  }
  return null;
}

/** 执行一次拖拽落点；无效落点返回 `changed: false`。 */
export function applyDrop(
  document: ResumeDocument,
  drag: StructureNode,
  target: StructureNode,
  side: DropSide,
): StructureCommandResult {
  const intent = resolveDropIntent(document, drag, target, side);
  if (!intent) return unchanged(document);
  if (intent.kind === "move-item") {
    const next = moveItem(document, intent.path, {
      placement: intent.placement,
      toIndex: intent.toIndex,
    });
    return next === document ? unchanged(document) : { document: next, changed: true };
  }
  if (intent.kind === "move-entry") {
    const next = moveEntry(document, intent.path, intent.toIndex);
    return next === document ? unchanged(document) : { document: next, changed: true };
  }
  return unchanged(document);
}

/** 当前 item 所在的纸面位置（面板显示"移到…"菜单时用）。 */
export function itemPlacementOf(document: ResumeDocument, path: string): Placement | null {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return null;
  return getItemPlacement(located.item);
}
