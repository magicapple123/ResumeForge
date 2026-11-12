// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板的状态机：树 / 展开 / 搜索 / 选中 / 键盘 / 拖拽会话 / 画布高亮。
 *
 * 数据全部来自 `features/resume/document`（summarize + entries/placement/mutations），
 * 本 hook 只做"视图状态 + 把一次交互翻译成一条命令"。组件（`StructurePanel`）只负责画。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { summarize } from "../document/summarize";
import type { StructureNode } from "../document/summarize";
import { parseDocumentPath } from "../document/paths";
import { t } from "../../../i18n";
import {
  ancestorKeys,
  collectExpandableKeys,
  countTree,
  flattenVisible,
  indexNodes,
  searchTree,
} from "./structureView";
import {
  applyDrop,
  duplicateEntry,
  moveItemToPlacement,
  toggleNodeHidden,
  toggleNodeLock,
  type DropSide,
  type StructureCommandResult,
} from "./structureCommands";
import { useStructureEntryMenu, type StructureEntryMenuApi } from "./useStructureEntryMenu";
import { highlightTargetsForNode, useCanvasPathHighlight } from "./structureHighlight";
import { useStructureHoverPaint } from "./useStructureHoverPaint";
import { queryTreeRow } from "./structureDom";
import { useStructureMultiSelect, type StructureMultiSelect } from "./useStructureMultiSelect";
import { useStructureKeyNav } from "./useStructureKeyNav";

export type { StructureMultiSelect } from "./useStructureMultiSelect";

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
  /** #11a：枚举字段值的显示名解析（工作类型等不再裸显 code）；透传给 summarize。 */
  enumValue?: (sectionKey: string, fieldKey: string, value: string) => string;
  /**
   * 搜索用的展示文案（R-09）：搜索匹配的是用户**看得见**的字（板块中文名、字段目录标签、
   * 位置名），不是文档里的原始 key / 枚举值。由面板构造（面板里有 t()）。
   */
  displayLabel?: (node: StructureNode) => string;
  /** 搜索：外部（如"在结构中搜索"入口）可注入初始值。 */
  initialQuery?: string;
  /** 树容器 ref 由组件持有（hook 不返回 ref，避免被渲染期规则判成"访问 ref 值"）。 */
  treeRef: React.RefObject<HTMLDivElement | null>;
  /** U7 多选（可选）：不传 / null = 树内没有多选行为（不出高亮、不响应 Shift）。 */
  multiSelect?: StructureMultiSelect | null;
  /**
   * #7：条目行右键菜单的「排版整条…」出口。宿主接了就打开**整条范围**的排版浮层
   * （`objects[<entryId>]`）；不传 = 这一项点了静默跳过（测试里单独渲染面板时）。
   */
  onRequestEntryStyle?: (request: { path: string; x: number; y: number }) => void;
}

export interface StructurePanelApi extends StructureEntryMenuApi {
  rows: ReturnType<typeof flattenVisible>;
  query: string;
  setQuery: (query: string) => void;
  collapsed: ReadonlySet<string>;
  matchedKeys: ReadonlySet<string>;
  counts: { sections: number; entries: number; items: number };
  selectedKey: string;
  /** 选中行的全部祖先键（R-14：树上标出"选中项在这条链上"，折叠时也能看出归属）。 */
  selectedAncestorKeys: ReadonlySet<string>;
  activeKey: string;
  drag: { node: StructureNode; overKey: string; side: DropSide } | null;
  readOnly: boolean;
  toggleCollapse: (key: string) => void;
  toggleAll: (expanded: boolean) => void;
  /**
   * 全展开态（顶栏那个唯一的折叠开关的状态来源）：所有可展开行都没有被折叠。
   * 只在 hook 里派生一次，组件不再自己算一遍（两处各算一份必然漂移）。
   */
  allExpanded: boolean;
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
  /** U7 多选是否可用（宿主给了状态且非只读）。 */
  multiSelectEnabled: boolean;
  /** 宿主持有的多选条目路径（不启用时是空数组）。 */
  multiSelectedPaths: readonly string[];
  /**
   * Shift 连选：把「锚点 → 目标条目」之间**可见的**条目并入选择（只合并、不替换）。
   * Shift 点击与 Shift + ↑/↓ 共用这一个实现。
   */
  extendSelectionTo: (node: StructureNode) => void;
  /** 清空多选（非 Shift 的普通点击；R-12 起点击是唯一入口，也是唯一清空入口）。 */
  clearSelection: () => void;
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
  enumValue,
  displayLabel,
  initialQuery = "",
  treeRef,
  multiSelect = null,
  onRequestEntryStyle,
}: StructurePanelOptions): StructurePanelApi {
  const tree = useMemo(
    () =>
      summarize(document, {
        resolveFieldLabel: fieldLabel,
        resolveEnumValue: enumValue,
      }),
    [document, fieldLabel, enumValue],
  );
  const index = useMemo(() => indexNodes(tree), [tree]);
  /** 有子节点的键（「展开/收起全部」与 allExpanded 共用一份，避免每次交互重走整棵树）。 */
  const expandableKeys = useMemo(() => collectExpandableKeys(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState(initialQuery);
  const [activeKey, setActiveKey] = useState("");
  const [drag, setDrag] = useState<{ node: StructureNode; overKey: string; side: DropSide } | null>(
    null,
  );
  const handledPickNonce = useRef<number | null>(null);
  /**
   * R-12：树内点击不产生额外滚动。点击时把"这次选中来自树"记在 ref 上，
   * 下面的同步 effect 见到就跳过 `scrollIntoView` 并复位（行就在用户眼皮底下）。
   */
  const internalSelectKey = useRef<string | null>(null);

  const search = useMemo(
    () => searchTree(tree, query, { labelOf: displayLabel }),
    [tree, query, displayLabel],
  );
  // 空查询走普通展开态（searchTree 的"空查询"分支是全展开的搜索视图，不读折叠集合）。
  const rows = useMemo(
    () => (query.trim() ? search.rows : flattenVisible(tree, collapsed)),
    [collapsed, query, search.rows, tree],
  );
  // U7 多选（R-12）：区间计算与锚点维护拆到独立 hook（见 useStructureMultiSelect.ts）。
  const multiSelectApi = useStructureMultiSelect({ multiSelect, readOnly, rows });
  const counts = useMemo(() => countTree(tree), [tree]);
  const selectedNode = useMemo(() => {
    if (!selectedPath) return null;
    for (const node of index.values()) {
      if (node.path && node.path === selectedPath) return node;
    }
    return null;
  }, [index, selectedPath]);
  const selectedKey = selectedNode?.key ?? "";
  const selectedAncestorKeys = useMemo(
    () => new Set(selectedNode ? ancestorKeys(tree, selectedNode.key) : []),
    [selectedNode, tree],
  );
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
  // 树内点击（R-12）只展开与激活，不滚动：否则点第 5 行会把整棵树滚一下，看着像"跳帧"。
  useEffect(() => {
    if (!selectedNode) return;
    const internal = internalSelectKey.current === selectedNode.key;
    if (internal) internalSelectKey.current = null;
    // 展开/激活属于外部选中同步：放进微任务，避开 effect 体里同步 setState 的级联渲染告警。
    queueMicrotask(() => {
      expandAncestors(selectedNode.key);
      setActiveKey(selectedNode.key);
    });
    if (internal) return;
    // 行可能还没渲染（展开是状态更新）：下一帧再找。
    const frame = requestAnimationFrame(() => {
      const row = queryTreeRow(treeRef.current, selectedNode.key);
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
      // R-14：纸面点击**不**再让右栏滚一次——用户点的那个字段本来就在眼前，
      // 再滚一次会把纸面挪到别处（验收口径："右栏不二次滚动"）。定位只走中栏。
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
      // R-12：先记下"这次来自树内"，同步 effect 会据此跳过 scrollIntoView。
      internalSelectKey.current = node.key;
      // Shift 连选的锚点也在这里落一次：点「已经选中」的那条时 selectedPath 没变化，
      // 面板里跟随 selectedPath 的那个 effect 不会重跑，锚点会丢（Shift 点击只选到一条）。
      multiSelectApi.rememberAnchor(node);
      // 纸面定位不在这里发起：宿主把这次选中标成 "structure" 来源，
      // `useWorkbenchSelectionSync` 的 canvasReveal 是**唯一**的定位出口（见该文件头）。
      onSelectPath?.(node.path ?? null);
      setActiveKey(node.key);
    },
    [multiSelectApi, onSelectPath],
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
      else setCollapsed(new Set(expandableKeys));
    },
    [expandableKeys],
  );

  // 顶栏只剩一个折叠开关（R-01）：全展开 = 没有任何可展开行处在折叠态。
  // 折叠集合是唯一真相，这里只派生、不另存一份状态（两份状态一定会漂移）。
  const allExpanded = useMemo(
    () => expandableKeys.every((key) => !collapsed.has(key)),
    [collapsed, expandableKeys],
  );

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

  // ── #7 条目右键菜单：动作拆到 useStructureEntryMenu（预算 + 单一落点）──
  const entryMenu = useStructureEntryMenu({
    document,
    readOnly,
    run,
    notify,
    onChange,
    onSelectPath,
    clearSelection: multiSelectApi.clearSelection,
    onRequestEntryStyle,
  });

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
  // R-12 之后键盘还多一条 Shift + ↑/↓ 连选；整块实现拆到 useStructureKeyNav.ts。
  const handleKeyDown = useStructureKeyNav({
    rows,
    tree,
    document,
    activeKey: active,
    collapsed,
    readOnly,
    treeRef,
    multiSelectEnabled: multiSelectApi.enabled,
    setActiveKey,
    expandAncestors,
    toggleCollapse,
    setCollapsed,
    selectNode,
    notify,
    run,
    extendSelectionTo: multiSelectApi.extendSelectionTo,
  });

  // ── 画布高亮：hover 为直接注入（见 handleRowHover），选中走 hook（重载后仍能恢复）──
  // 这里只管**高亮**：定位（scroll）由宿主的 canvasReveal 统一发起，面板不再自己滚一份。
  const selectedTargets = useMemo(() => highlightTargetsForNode(selectedNode), [selectedNode]);
  useEffect(() => {
    syncSelectedTargets(selectedTargets);
  }, [selectedTargets, syncSelectedTargets]);
  useCanvasPathHighlight({ targets: selectedTargets, container: canvasContainer });

  return {
    rows,
    query,
    setQuery,
    collapsed: expanded,
    matchedKeys: search.matchedKeys,
    counts,
    selectedKey,
    selectedAncestorKeys,
    activeKey: active,
    drag,
    readOnly,
    toggleCollapse,
    toggleAll,
    allExpanded,
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
    ...entryMenu,
    multiSelectEnabled: multiSelectApi.enabled,
    multiSelectedPaths: multiSelectApi.paths,
    extendSelectionTo: multiSelectApi.extendSelectionTo,
    clearSelection: multiSelectApi.clearSelection,
  };
}
