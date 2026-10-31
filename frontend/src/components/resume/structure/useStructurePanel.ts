// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板的状态机：树 / 展开 / 搜索 / 选中 / 键盘 / 拖拽会话 / 画布高亮。
 *
 * 数据全部来自 `features/resume-document`（summarize + entries/placement/mutations），
 * 本 hook 只做"视图状态 + 把一次交互翻译成一条命令"。组件（`StructurePanel`）只负责画。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { summarize, STRUCTURE_PLACEMENT_ORDER } from "../../../features/resume-document/summarize";
import type { StructureNode } from "../../../features/resume-document/summarize";
import { parseDocumentPath } from "../../../features/resume-document/paths";
import { t } from "../../../i18n";
import {
  ancestorKeys,
  collapseEntryKeys,
  collectExpandableKeys,
  countTree,
  flattenVisible,
  indexNodes,
  nextRowKey,
  searchTree,
} from "./structureView";
import {
  applyDrop,
  duplicateEntry,
  moveEntryOneStep,
  moveItemOneStep,
  moveItemToPlacement,
  toggleNodeHidden,
  toggleNodeLock,
  type DropSide,
  type StructureCommandResult,
} from "./structureCommands";
import { highlightTargetsForNode, useCanvasPathHighlight } from "./structureHighlight";
import { useStructureHoverPaint } from "./useStructureHoverPaint";

export interface StructurePanelOptions {
  document: ResumeDocument;
  /** 唯一回流口：面板只提交"新文档"，历史/保存由宿主决定。 */
  onChange: (next: ResumeDocument) => void;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  onHoverPath?: (path: string | null) => void;
  /** 纸面点击目标（与中栏同一份 `{path, nonce}`）：反向选中并展开祖先。 */
  pickTarget?: { path: string; nonce: number } | null;
  canvasContainer?: HTMLElement | null;
  /** 结构命令失败 / 完成时的提示出口（宿主接 Toast；不传 = 静默）。 */
  onNotify?: (message: string) => void;
  readOnly?: boolean;
  /**
   * 字段目录标签解析（Q20）：item 没有值时用目录标签代替原始英文 key。
   * 由面板用 `fieldCatalogLabelResolver` 构造，hook 只负责透传给 summarize。
   */
  fieldLabel?: (key: string, sectionKey?: string) => string | undefined;
  /** 搜索：外部（如"在结构中搜索"入口）可注入初始值。 */
  initialQuery?: string;
  /** 树容器 ref 由组件持有（hook 不返回 ref，避免被渲染期规则判成"访问 ref 值"）。 */
  treeRef: React.RefObject<HTMLDivElement | null>;
}

/** 把键安全地放进属性选择器的引号里（key 只含 id/点/井号/冒号/连字符；引号与反斜杠兜底转义）。 */
export function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface StructurePanelApi {
  rows: ReturnType<typeof flattenVisible>;
  query: string;
  setQuery: (query: string) => void;
  collapsed: ReadonlySet<string>;
  matchedKeys: ReadonlySet<string>;
  counts: { sections: number; entries: number; items: number };
  selectedKey: string;
  activeKey: string;
  reveal: { path: string; nonce: number } | null;
  drag: { node: StructureNode; overKey: string; side: DropSide } | null;
  readOnly: boolean;
  toggleCollapse: (key: string) => void;
  toggleAll: (expanded: boolean) => void;
  /** 只收起所有条目：板块保持展开，页眉分组保持可见。 */
  collapseEntries: () => void;
  selectNode: (node: StructureNode | null) => void;
  handleRowHover: (node: StructureNode | null) => void;
  handlePointerDrop: (target: StructureNode, side: DropSide) => void;
  handlePointerDragStart: (node: StructureNode) => void;
  handlePointerDragEnd: () => void;
  handleDragOver: (target: StructureNode, side: DropSide) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  toggleHidden: (node: StructureNode) => void;
  toggleLock: (node: StructureNode, lock: "content" | "layout") => void;
  copyEntry: (node: StructureNode) => void;
  moveToPlacement: (node: StructureNode, placement: string) => void;
}

export function useStructurePanel({
  document,
  onChange,
  selectedPath,
  onSelectPath,
  onHoverPath,
  pickTarget,
  canvasContainer,
  onNotify,
  readOnly = false,
  fieldLabel,
  initialQuery = "",
  treeRef,
}: StructurePanelOptions): StructurePanelApi {
  const tree = useMemo(
    () => summarize(document, { resolveFieldLabel: fieldLabel }),
    [document, fieldLabel],
  );
  const index = useMemo(() => indexNodes(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState(initialQuery);
  const [activeKey, setActiveKey] = useState("");
  const [reveal, setReveal] = useState<{ path: string; nonce: number } | null>(null);
  const [drag, setDrag] = useState<{ node: StructureNode; overKey: string; side: DropSide } | null>(
    null,
  );
  const handledPickNonce = useRef<number | null>(null);

  const search = useMemo(() => searchTree(tree, query), [tree, query]);
  // 空查询走普通展开态（searchTree 的"空查询"分支是全展开的搜索视图，不读折叠集合）。
  const rows = useMemo(
    () => (query.trim() ? search.rows : flattenVisible(tree, collapsed)),
    [collapsed, query, search.rows, tree],
  );
  const counts = useMemo(() => countTree(tree), [tree]);
  const selectedNode = useMemo(() => {
    if (!selectedPath) return null;
    for (const node of index.values()) {
      if (node.path && node.path === selectedPath) return node;
    }
    return null;
  }, [index, selectedPath]);
  const selectedKey = selectedNode?.key ?? "";
  const active = rows.some((row) => row.node.key === activeKey)
    ? activeKey
    : (rows[0]?.node.key ?? "");
  const expanded = useMemo(() => {
    if (query.trim()) {
      // 搜索态：除了折叠标记以外，命中分支全展开（否则搜索永远看不到深层字段）。
      return new Set<string>();
    }
    return collapsed;
  }, [collapsed, query]);

  /** 展开某键的全部祖先（选中/纸面定位时用）。 */
  const expandAncestors = useCallback(
    (key: string) => {
      const ancestors = ancestorKeys(tree, key);
      if (ancestors.length === 0) return;
      setCollapsed((previous) => {
        let changed = false;
        const next = new Set(previous);
        for (const ancestor of ancestors) {
          if (next.delete(ancestor)) changed = true;
        }
        return changed ? next : previous;
      });
    },
    [tree],
  );

  // 外部选中（纸面点击 / 编辑器选中）→ 展开祖先、激活行、滚动到位。
  useEffect(() => {
    if (!selectedNode) return;
    // 展开/激活属于外部选中同步：放进微任务，避开 effect 体里同步 setState 的级联渲染告警。
    queueMicrotask(() => {
      expandAncestors(selectedNode.key);
      setActiveKey(selectedNode.key);
    });
    // 行可能还没渲染（展开是状态更新）：下一帧再找。
    const frame = requestAnimationFrame(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(
        `[data-tree-key="${cssAttrEscape(selectedNode.key)}"]`,
      );
      // jsdom 没有 scrollIntoView；真实浏览器里它只是"把行滚到可视区"，缺了不影响选择。
      if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedNode, expandAncestors, treeRef]);

  // 纸面点击（含 nonce 去重）：同一路径连点两次也要重新展开 + 定位。
  useEffect(() => {
    if (!pickTarget || handledPickNonce.current === pickTarget.nonce) return;
    handledPickNonce.current = pickTarget.nonce;
    const parsed = parseDocumentPath(pickTarget.path);
    if (!parsed) return;
    // 找到 path 对应节点（section/entry/item/header item）。
    const target = [...index.values()].find((node) => node.path === pickTarget.path);
    // 纸面点击定位也走微任务：不在 effect 体里同步 setState（仍在本帧内完成）。
    queueMicrotask(() => {
      if (target) {
        expandAncestors(target.key);
        setActiveKey(target.key);
      }
      setReveal({ path: pickTarget.path, nonce: pickTarget.nonce });
    });
  }, [pickTarget, index, expandAncestors]);

  const notify = useCallback(
    (message: string) => {
      onNotify?.(message);
    },
    [onNotify],
  );

  const run = useCallback(
    (result: StructureCommandResult, successMessage?: string) => {
      if (readOnly) return;
      if (!result.changed) {
        notify(t("structure.drag.invalid"));
        return;
      }
      onChange(result.document);
      if (result.selectPath) onSelectPath?.(result.selectPath);
      if (successMessage) notify(successMessage);
    },
    [notify, onChange, onSelectPath, readOnly],
  );

  const selectNode = useCallback(
    (node: StructureNode | null) => {
      if (!node) {
        onSelectPath?.(null);
        return;
      }
      onSelectPath?.(node.path ?? null);
      if (node.path) setReveal({ path: node.path, nonce: Date.now() });
      setActiveKey(node.key);
    },
    [onSelectPath],
  );

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else {
        // 折叠一个节点时，把它的后代从折叠集合里清掉（下次展开时恢复默认展开）。
        for (const candidate of next) {
          if (candidate.startsWith(`${key}.`) || candidate.startsWith(`${key}#`))
            next.delete(candidate);
        }
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (expand: boolean) => {
      if (expand) setCollapsed(new Set());
      else setCollapsed(new Set(collectExpandableKeys(tree)));
    },
    [tree],
  );

  // 「收起所有条目」不是「收起全部」：板块标题和页眉分组要保持可见，只把每个
  // 条目折叠起来，让用户一眼看到 13 个板块的骨架，而不是只剩最外层。
  const collapseEntries = useCallback(() => {
    setCollapsed(collapseEntryKeys(tree.sections));
  }, [tree]);

  // 悬停高亮**不走 React state**：树有 160+ 行，若每次 mouseenter/leave 都重渲染
  // 整个面板并重挂 iframe 的 MutationObserver，滚轮经过行时会稳定掉到 100ms+ 一帧。
  // 这里改为直接向画布注入高亮，行自身的 :hover 由 CSS 负责；选中高亮仍走
  // useCanvasPathHighlight（它在 iframe 重载时会重新应用）。
  const { handleRowHover, syncSelectedTargets } = useStructureHoverPaint(
    canvasContainer,
    onHoverPath,
  );

  const toggleHidden = useCallback(
    (node: StructureNode) => run(toggleNodeHidden(document, node)),
    [document, run],
  );
  const toggleLock = useCallback(
    (node: StructureNode, lock: "content" | "layout") => run(toggleNodeLock(document, node, lock)),
    [document, run],
  );
  const copyEntry = useCallback(
    (node: StructureNode) => {
      const result = duplicateEntry(document, node);
      if (result.changed) {
        onChange(result.document);
        if (result.selectPath) onSelectPath?.(result.selectPath);
        notify(t("structure.action.copyEntry"));
      } else notify(t("structure.drag.invalid"));
    },
    [document, notify, onChange, onSelectPath],
  );
  const moveToPlacement = useCallback(
    (node: StructureNode, placement: string) => {
      run(moveItemToPlacement(document, node, placement as never));
    },
    [document, run],
  );

  // ── 拖拽 ───────────────────────────────────────────────────
  const handlePointerDragStart = useCallback((node: StructureNode) => {
    setDrag({ node, overKey: "", side: "inside" });
  }, []);
  const handleDragOver = useCallback((target: StructureNode, side: DropSide) => {
    setDrag((previous) => {
      if (!previous) return previous;
      if (previous.overKey === target.key && previous.side === side) return previous;
      return { ...previous, overKey: target.key, side };
    });
  }, []);
  const handlePointerDragEnd = useCallback(() => setDrag(null), []);
  const handlePointerDrop = useCallback(
    (target: StructureNode, side: DropSide) => {
      const current = drag;
      setDrag(null);
      if (!current || readOnly) return;
      const result = applyDrop(document, current.node, target, side);
      if (!result.changed) {
        notify(t("structure.drag.invalid"));
        return;
      }
      onChange(result.document);
    },
    [document, drag, notify, onChange, readOnly],
  );

  // ── 键盘（与鼠标等价；Alt 组合做移动）──────────────────────
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const rowElement = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tree-key]",
      );
      const key = rowElement?.dataset.treeKey ?? active;
      const row = rows.find((candidate) => candidate.node.key === key);
      if (!row) return;
      const node = row.node;
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
          else onChange(result.document);
          return;
        }
        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          node.kind === "item" &&
          !node.key.startsWith("header.")
        ) {
          event.preventDefault();
          if (readOnly) return;
          const current = node.placement;
          const order = STRUCTURE_PLACEMENT_ORDER;
          const position = current ? order.indexOf(current) : -1;
          const next = order[position + (event.key === "ArrowRight" ? 1 : -1)];
          if (position < 0 || !next) {
            notify(t("structure.drag.invalid"));
            return;
          }
          const result = moveItemToPlacement(document, node, next);
          if (!result.changed) notify(t("structure.drag.invalid"));
          else onChange(result.document);
          return;
        }
        return;
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
          if (!next) return;
          setActiveKey(next);
          treeRef.current
            ?.querySelector<HTMLElement>(`[data-tree-key="${cssAttrEscape(next)}"]`)
            ?.focus();
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
            if (parent) {
              setActiveKey(parent);
              treeRef.current
                ?.querySelector<HTMLElement>(`[data-tree-key="${cssAttrEscape(parent)}"]`)
                ?.focus();
            }
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
      active,
      collapsed,
      document,
      expandAncestors,
      notify,
      onChange,
      readOnly,
      rows,
      selectNode,
      tree,
      treeRef,
      toggleCollapse,
    ],
  );

  // ── 画布高亮：hover 为直接注入（见 handleRowHover），选中走 hook（重载后仍能恢复）──
  const selectedTargets = useMemo(() => highlightTargetsForNode(selectedNode), [selectedNode]);
  useEffect(() => {
    syncSelectedTargets(selectedTargets);
  }, [selectedTargets, syncSelectedTargets]);
  useCanvasPathHighlight({ targets: selectedTargets, container: canvasContainer, reveal });

  return {
    rows,
    query,
    setQuery,
    collapsed: expanded,
    matchedKeys: search.matchedKeys,
    counts,
    selectedKey,
    activeKey: active,
    reveal,
    drag,
    readOnly,
    toggleCollapse,
    toggleAll,
    collapseEntries,
    selectNode,
    handleRowHover,
    handlePointerDrop,
    handlePointerDragStart,
    handlePointerDragEnd,
    handleDragOver,
    handleKeyDown,
    toggleHidden,
    toggleLock,
    copyEntry,
    moveToPlacement,
  };
}
