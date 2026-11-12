// SPDX-License-Identifier: Apache-2.0
/**
 * 结构树多选（U7 / R-12）：宿主持有的路径集合 + Shift 连选的区间计算。
 *
 * 从 `useStructurePanel` 拆出（2026-10-31，R-12 之后该文件逼近 500 行预算）。
 * 这一层的职责只有三件事：读宿主的路径集合、算「锚点 → 目标」的可见条目区间、
 * 把结果交回宿主。它不碰文档、不改树，也不决定哪一行高亮（那是 `StructureRows` 的事）。
 */
import { useCallback } from "react";
import type { StructureNode } from "../document/summarize";
import type { StructureRow } from "./structureView";

/** U7 多选：宿主持有的选择状态 + 出口 + Shift 连选锚点。不传 = 树内不启用多选。 */
export interface StructureMultiSelect {
  /** 宿主持有的条目路径（`section.entryId`）。 */
  paths: readonly string[];
  /** 变化出口（只回传条目路径集合）。 */
  onChange: (paths: string[]) => void;
  /** 读「最后点击条目」锚点（Shift 连选的区间起点）。 */
  getAnchor: () => string | null;
  /** 写锚点（区间端点递进）。锚点 ref 由面板持有，hook 只经这两个函数读写。 */
  setAnchor: (path: string | null) => void;
}

/** 未启用多选时返回的同一个空数组（每次渲染新造数组会让行级比较永远不相等）。 */
const EMPTY_PATHS: readonly string[] = [];

export interface StructureMultiSelectApi {
  /** 是否启用（宿主给了状态且非只读）。 */
  enabled: boolean;
  /** 宿主持有的多选条目路径（不启用时是空数组）。 */
  paths: readonly string[];
  /** 点中条目时记锚点（也覆盖"点已经选中的那条"这种 selectedPath 不变的情况）。 */
  rememberAnchor: (node: StructureNode) => void;
  /** Shift 连选：把「锚点 → 目标条目」之间**可见的**条目并入选择（只合并、不替换）。 */
  extendSelectionTo: (node: StructureNode) => void;
  /** 清空多选（非 Shift 的普通点击；R-12 起点击是唯一入口，也是唯一清空入口）。 */
  clearSelection: () => void;
}

export function useStructureMultiSelect({
  multiSelect,
  readOnly,
  rows,
}: {
  multiSelect: StructureMultiSelect | null;
  readOnly: boolean;
  rows: readonly StructureRow[];
}): StructureMultiSelectApi {
  const enabled = Boolean(multiSelect) && !readOnly;

  const rememberAnchor = useCallback(
    (node: StructureNode) => {
      if (!multiSelect) return;
      if (node.kind !== "entry" || !node.path) return;
      multiSelect.setAnchor(node.path);
    },
    [multiSelect],
  );

  /**
   * Shift 连选：在**可见条目行顺序**上取「锚点 → 目标」区间并入已有选择。
   *
   * 只合并不替换——批量样式是增量目标集合，Shift 不该悄悄丢掉之前选中的条目；
   * 折叠状态下区间会自然变短（区间只在当前可见行里数），这是有意为之。
   */
  const extendSelectionTo = useCallback(
    (node: StructureNode) => {
      if (!multiSelect || readOnly) return;
      if (node.kind !== "entry" || !node.path) return;
      const entryPaths: string[] = [];
      for (const row of rows) {
        if (row.node.kind === "entry" && row.node.path) entryPaths.push(row.node.path);
      }
      const currentIndex = entryPaths.indexOf(node.path);
      if (currentIndex < 0) return;
      const anchor = multiSelect.getAnchor();
      const anchorIndex = anchor ? entryPaths.indexOf(anchor) : -1;
      const from = anchorIndex < 0 ? currentIndex : Math.min(anchorIndex, currentIndex);
      const to = anchorIndex < 0 ? currentIndex : Math.max(anchorIndex, currentIndex);
      const next = new Set(multiSelect.paths);
      for (const path of entryPaths.slice(from, to + 1)) next.add(path);
      // 端点成为新锚点：连续按 Shift + ↓ 时区间逐步递进，而不是每次重算同一段。
      multiSelect.setAnchor(node.path);
      multiSelect.onChange([...next]);
    },
    [multiSelect, readOnly, rows],
  );

  const clearSelection = useCallback(() => {
    if (!multiSelect) return;
    multiSelect.setAnchor(null);
    if (multiSelect.paths.length > 0) multiSelect.onChange([]);
  }, [multiSelect]);

  return {
    enabled,
    paths: multiSelect?.paths ?? EMPTY_PATHS,
    rememberAnchor,
    extendSelectionTo,
    clearSelection,
  };
}
