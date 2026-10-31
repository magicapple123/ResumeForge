// SPDX-License-Identifier: Apache-2.0
/**
 * 「本份简历结构」树的**纯视图逻辑**（无 React、无文档写操作）。
 *
 * 数据源是 `features/resume-document/summarize` 产出的 `StructureTree`；这里只做
 * "展开/收起后可见哪些行、搜索命中谁、键盘下一个是谁、选中对象在纸面上高亮哪几段路径"。
 * 写操作（排序/跨组移动/复制/隐藏/锁定）在 `structureCommands.ts`，命令一律走
 * `features/resume-document` 的不可变实现——面板里不再有第二份改文档的算法。
 */

import type { StructureNode, StructureTree } from "../../../features/resume-document/summarize";

export type { StructureNode, StructureTree };
export type StructureViewNode = StructureNode;
export type StructureViewTree = StructureTree;

/** 位置枚举的展示顺序：与纸面从上到下的顺序一致（隐藏排在最后）。 */
export const PLACEMENT_ORDER = ["title", "meta", "lead", "body", "trail", "hidden"] as const;
export type PlacementKey = (typeof PLACEMENT_ORDER)[number];

/** 一行可见节点（缩进层级 = 祖先数）。 */
export interface StructureRow {
  node: StructureNode;
  depth: number;
}

/** 树里所有节点的稳定键（DOM 焦点、展开集合用）。 */
export function nodeKey(node: StructureNode): string {
  return node.key;
}

/** 把一个节点的直接子节点按"是否展开"摊平；`collapsed` 里没有的节点默认展开。 */
function visit(
  node: StructureNode,
  depth: number,
  collapsed: ReadonlySet<string>,
  out: StructureRow[],
): void {
  out.push({ node, depth });
  if (!node.children || node.children.length === 0) return;
  if (collapsed.has(node.key)) return;
  for (const child of node.children) visit(child, depth + 1, collapsed, out);
}

/**
 * 当前可见行（先页眉，再板块；分组/字段按 summarize 给的顺序）。
 *
 * 页眉在结构面板里也占树位：不然"姓名/联系方式"这类 header item 只能在中栏改，
 * 结构面板的搜索永远搜不到它们。
 */
export function flattenVisible(
  tree: StructureTree,
  collapsed: ReadonlySet<string>,
): StructureRow[] {
  const rows: StructureRow[] = [];
  for (const node of tree.header) visit(node, 0, collapsed, rows);
  for (const node of tree.sections) visit(node, 0, collapsed, rows);
  return rows;
}

/** 可展开节点（有子节点的）的键；"展开全部"用。 */
export function collectExpandableKeys(tree: StructureTree): string[] {
  const keys: string[] = [];
  const walk = (node: StructureNode) => {
    if (node.children && node.children.length > 0) {
      keys.push(node.key);
      for (const child of node.children) walk(child);
    }
  };
  for (const node of tree.header) walk(node);
  for (const node of tree.sections) walk(node);
  return keys;
}

/** 「收起所有条目」只折叠 section 下的 entry，板块标题保持展开。 */
export function collapseEntryKeys(sections: readonly StructureNode[]): Set<string> {
  const keys = new Set<string>();
  for (const section of sections) {
    for (const child of section.children ?? []) {
      if (child.kind === "entry") keys.add(child.key);
    }
  }
  return keys;
}

export interface StructureCounts {
  sections: number;
  entries: number;
  items: number;
}

/** 概览计数：板块 / 条目 / 字段（页眉字段计入 items，不单列一行）。 */
export function countTree(tree: StructureTree): StructureCounts {
  let entries = 0;
  let items = 0;
  const walk = (node: StructureNode) => {
    if (node.kind === "entry") entries += 1;
    if (node.kind === "item") items += 1;
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of tree.header) walk(node);
  for (const node of tree.sections) walk(node);
  return { sections: tree.sections.length, entries, items };
}

/** 键 → 节点（搜索展开、纸面反选定位用）。 */
export function indexNodes(tree: StructureTree): Map<string, StructureNode> {
  const index = new Map<string, StructureNode>();
  const walk = (node: StructureNode) => {
    index.set(node.key, node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of tree.header) walk(node);
  for (const node of tree.sections) walk(node);
  return index;
}

/**
 * 键 → 祖先键列表（由外到内，不含自身）。
 *
 * 纸面点了一行字段/搜索命中一个深层节点时，要把祖先全展开才看得见它；
 * 反过来"折叠某板块"只需要祖先列表的第一个元素，不用另算一次。
 */
export function ancestorKeys(tree: StructureTree, key: string): string[] {
  const path: string[] = [];
  const walk = (node: StructureNode, trail: string[]): boolean => {
    if (node.key === key) {
      path.push(...trail);
      return true;
    }
    for (const child of node.children ?? []) {
      if (walk(child, [...trail, node.key])) return true;
    }
    return false;
  };
  for (const node of tree.header) {
    if (walk(node, [])) return path;
  }
  for (const node of tree.sections) {
    if (walk(node, [])) return path;
  }
  return [];
}

/** 搜索的规范化：大小写不敏感、去首尾空白。空串 = 没有搜索。 */
export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export interface SearchResult {
  /** 搜索态下要显示的行（命中节点 + 它们的祖先 / 子树）。 */
  rows: StructureRow[];
  /** 剪枝后留下的全部节点键（行内高亮与"是否展开"共用）。 */
  matchedKeys: Set<string>;
  /** 真正内容命中的节点键（不含祖先；计数用）。 */
  hitKeys: Set<string>;
}

/**
 * 搜索过滤：只显示"标签包含查询"的节点与它们的祖先，祖先自动展开。
 *
 * 自命中时保留整棵子树（用户搜板块名，多半想看到它下面的内容）；只有子节点命中时
 * 只保留命中的分支，兄弟不显示（否则搜"学校"会显示整个教育板块的所有字段）。
 */
export function searchTree(tree: StructureTree, query: string): SearchResult {
  const normalized = normalizeQuery(query);
  const matchedKeys = new Set<string>();
  const hitKeys = new Set<string>();
  if (!normalized) return { rows: flattenVisible(tree, new Set()), matchedKeys, hitKeys };

  const prune = (node: StructureNode): StructureNode | null => {
    const selfHit = node.label.toLocaleLowerCase().includes(normalized);
    const keptChildren: StructureNode[] = [];
    for (const child of node.children ?? []) {
      const kept = prune(child);
      if (kept) keptChildren.push(kept);
    }
    if (!selfHit && keptChildren.length === 0) return null;
    return { ...node, children: selfHit ? (node.children ?? []) : keptChildren };
  };
  const rows: StructureRow[] = [];
  const append = (node: StructureNode, depth: number) => {
    rows.push({ node, depth });
    matchedKeys.add(node.key);
    if (node.label.toLocaleLowerCase().includes(normalized)) hitKeys.add(node.key);
    for (const child of node.children ?? []) append(child, depth + 1);
  };
  for (const top of [...tree.header, ...tree.sections]) {
    const kept = prune(top);
    if (kept) append(kept, 0);
  }
  return { rows, matchedKeys, hitKeys };
}

/** 可见行里的下一个/上一个键（键盘 ↑↓/Home/End 用）。 */
export function nextRowKey(
  rows: readonly StructureRow[],
  activeKey: string,
  direction: "up" | "down" | "home" | "end",
): string {
  if (rows.length === 0) return "";
  const index = rows.findIndex((row) => row.node.key === activeKey);
  if (direction === "home") return rows[0].node.key;
  if (direction === "end") return rows[rows.length - 1].node.key;
  if (index < 0) return rows[0].node.key;
  const next = direction === "down" ? index + 1 : index - 1;
  return rows[Math.min(Math.max(next, 0), rows.length - 1)].node.key;
}

/** 位置分组的展示顺序（页眉分组不在此列，由 summarize 决定）。 */
export function placementRank(placement: string | undefined): number {
  const index = PLACEMENT_ORDER.indexOf((placement ?? "") as PlacementKey);
  return index < 0 ? PLACEMENT_ORDER.length : index;
}
