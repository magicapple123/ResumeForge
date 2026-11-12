// SPDX-License-Identifier: Apache-2.0
/**
 * 结构树的键盘导航（↑↓/Home/End/←→/Enter/Space + Alt 移动 + R-12 的 Shift 连选）。
 *
 * 从 `useStructurePanel` 拆出（2026-10-31，R-12 之后该文件逼近 500 行预算）：
 * 键盘这一块有 40 余个依赖，留在状态机里会把"视图状态"和"键盘等价"读成同一段代码。
 * 这里不直接改文档——移动类操作全部经由面板传入的命令回调。
 */
import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import type { ResumeDocument } from "../../../types/resumeDocument";
import {
  STRUCTURE_PLACEMENT_ORDER,
  type StructureNode,
  type StructureTree,
} from "../document/summarize";
import { t } from "../../../i18n";
import { ancestorKeys, nextRowKey, type StructureRow } from "./structureView";
import { focusTreeRow } from "./structureDom";
import {
  moveEntryOneStep,
  moveItemOneStep,
  moveItemToPlacement,
  type StructureCommandResult,
} from "./structureCommands";

/** 键盘落点：把"焦点 + 激活行"一起挪到某个键上（行可能还没渲染）。 */
export type StructureFocusRow = (key: string) => void;

export interface StructureKeyNavOptions {
  rows: readonly StructureRow[];
  tree: StructureTree;
  document: ResumeDocument;
  /** 当前激活行（没有焦点落点时用它兜底）。 */
  activeKey: string;
  collapsed: ReadonlySet<string>;
  readOnly: boolean;
  treeRef: React.RefObject<HTMLDivElement | null>;
  /** Shift 连选是否可用（宿主给了多选状态且非只读）。 */
  multiSelectEnabled: boolean;
  setActiveKey: (key: string) => void;
  expandAncestors: (key: string) => void;
  toggleCollapse: (key: string) => void;
  setCollapsed: (updater: (previous: Set<string>) => Set<string>) => void;
  selectNode: (node: StructureNode | null) => void;
  notify: (message: string) => void;
  /** 顺序类命令的落地（内部已带只读判断与提示）。 */
  run: (result: StructureCommandResult, successMessage?: string) => void;
  extendSelectionTo: (node: StructureNode) => void;
}

export function useStructureKeyNav({
  rows,
  tree,
  document,
  activeKey,
  collapsed,
  readOnly,
  treeRef,
  multiSelectEnabled,
  setActiveKey,
  expandAncestors,
  toggleCollapse,
  setCollapsed,
  selectNode,
  notify,
  run,
  extendSelectionTo,
}: StructureKeyNavOptions) {
  const focusRow: StructureFocusRow = useCallback(
    (key: string) => {
      setActiveKey(key);
      focusTreeRow(treeRef.current, key);
    },
    [setActiveKey, treeRef],
  );

  /** 从当前行朝某个方向找最近的**条目**行（Shift 连选跳过分组行与字段行）。 */
  const adjacentEntry = useCallback(
    (fromKey: string, step: 1 | -1): StructureNode | null => {
      const startIndex = rows.findIndex((candidate) => candidate.node.key === fromKey);
      for (let index = startIndex + step; index >= 0 && index < rows.length; index += step) {
        const candidate = rows[index].node;
        if (candidate.kind === "entry" && candidate.path) return candidate;
      }
      return null;
    },
    [rows],
  );

  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const rowElement = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tree-key]",
      );
      const key = rowElement?.dataset.treeKey ?? activeKey;
      const row = rows.find((candidate) => candidate.node.key === key);
      if (!row) return;
      const node = row.node;

      // Alt 组合：移动字段/条目（与拖动等价）。
      if (event.altKey) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          if (readOnly) return;
          const delta = event.key === "ArrowUp" ? -1 : 1;
          const result =
            node.kind === "entry"
              ? moveEntryOneStep(document, node, delta)
              : moveItemOneStep(document, node, delta);
          if (!result.changed) notify(t("structure.drag.invalid"));
          else run(result);
          return;
        }
        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          node.kind === "item" &&
          !node.key.startsWith("header.")
        ) {
          event.preventDefault();
          if (readOnly) return;
          const order = STRUCTURE_PLACEMENT_ORDER;
          const position = node.placement ? order.indexOf(node.placement) : -1;
          const next = order[position + (event.key === "ArrowRight" ? 1 : -1)];
          if (position < 0 || !next) {
            notify(t("structure.drag.invalid"));
            return;
          }
          const result = moveItemToPlacement(document, node, next);
          if (!result.changed) notify(t("structure.drag.invalid"));
          else run(result);
          return;
        }
        return;
      }

      // R-12：Shift + ↑/↓ 是 Shift 点击的键盘等价——把相邻的**条目**并入多选。
      // 中间的分组行 / 字段行跳过，否则按一下只走一行字段，永远选不到下一条。
      if (
        event.shiftKey &&
        multiSelectEnabled &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        const target = adjacentEntry(key, event.key === "ArrowDown" ? 1 : -1);
        if (target) {
          event.preventDefault();
          focusRow(target.key);
          extendSelectionTo(target);
          return;
        }
      }

      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Home":
        case "End": {
          event.preventDefault();
          const next = nextRowKey(
            rows,
            key,
            event.key === "ArrowDown"
              ? "down"
              : event.key === "ArrowUp"
                ? "up"
                : event.key === "Home"
                  ? "home"
                  : "end",
          );
          if (next) focusRow(next);
          break;
        }
        case "ArrowRight":
          if (node.children && node.children.length > 0) {
            event.preventDefault();
            expandAncestors(node.key);
            setCollapsed((previous) => {
              if (!previous.has(node.key)) return previous;
              const next = new Set(previous);
              next.delete(node.key);
              return next;
            });
          }
          break;
        case "ArrowLeft": {
          if (collapsed.has(node.key) && node.children?.length) return;
          event.preventDefault();
          if (node.children && node.children.length > 0 && !collapsed.has(node.key)) {
            toggleCollapse(node.key);
          } else {
            const ancestors = ancestorKeys(tree, node.key);
            const parent = ancestors[ancestors.length - 1];
            if (parent) focusRow(parent);
          }
          break;
        }
        case "Enter":
        case " ":
          event.preventDefault();
          selectNode(node);
          break;
        default:
          break;
      }
    },
    [
      activeKey,
      adjacentEntry,
      collapsed,
      document,
      expandAncestors,
      extendSelectionTo,
      focusRow,
      multiSelectEnabled,
      notify,
      readOnly,
      rows,
      run,
      selectNode,
      setCollapsed,
      toggleCollapse,
      tree,
    ],
  );
}
