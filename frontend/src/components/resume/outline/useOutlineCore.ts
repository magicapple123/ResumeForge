// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲树的**选择 / 多选 / 展开 / 焦点 / 键盘导航**（不含排序会话与结构写操作）。
 *
 * 拆出来的理由：这一层只回答"用户现在指着谁、树展开成什么样、上下键下一个是谁"，全是
 * 视图状态；写操作（排序/复制/隐藏/锁定）在 `useOutlineActions`，排序会话在
 * `useOutlineSort`。三者组合成 `useOutlineState`，面板只消费组合后的接口。
 *
 * 选择锚点一律是稳定 id（`OutlineSelection`）：排序只改顺序，选择对象不变。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import type { ResumeContent } from "../../../types/resume";
import {
  findOutlineEntry,
  findOutlinePoint,
  selectionFromPath,
} from "../../../features/resume-outline/model";
import type { OutlineSelection } from "../../../features/resume-outline/types";
import {
  entryKey,
  type OutlineEntry,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import { selectionForTreeKey, treeKeyForSelection, visibleTreeKeys } from "./outlineTree";

export interface OutlineCoreOptions {
  model: OutlineModel;
  baseContent: ResumeContent | null;
  /** 纸面点击的路径（含 nonce）：用来做"纸面 → 大纲"的反向选中。 */
  pickTarget?: { path: string; nonce: number } | null;
  onSelectionChange?: (selection: OutlineSelection | null) => void;
  /** 树容器：键盘移动焦点时按 `data-tree-key` 找到节点并 focus。 */
  treeRef: RefObject<HTMLElement | null>;
}

export interface OutlineCoreApi {
  selection: OutlineSelection | null;
  selectedEntry: OutlineEntry | null;
  selectedPoint: ReturnType<typeof findOutlinePoint>;
  multiSelectedEntries: OutlineEntry[];
  visibleKeys: string[];
  activeKey: string;
  collapsedSections: ReadonlySet<string>;
  expandedEntries: ReadonlySet<string>;
  select: (selection: OutlineSelection) => void;
  toggleSection: (field: string) => void;
  toggleEntry: (key: string) => void;
  toggleMultiSelect: (entry: OutlineEntry) => void;
  clearMultiSelect: () => void;
  handleTreeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function useOutlineCore({
  model,
  baseContent,
  pickTarget,
  onSelectionChange,
  treeRef,
}: OutlineCoreOptions): OutlineCoreApi {
  const [selection, setSelection] = useState<OutlineSelection | null>(null);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set());
  const [focusedKey, setFocusedKey] = useState("personal");
  const [handledPickNonce, setHandledPickNonce] = useState<number | null>(null);

  // ── 纸面点击 → 大纲反向选中（D01 双向定位）────────────────────────
  // 渲染期守卫（仓库既有写法）：只处理"新的 nonce"，同一路径连点两次也会重新展开+聚焦。
  // 不放进 effect 是为了避免"选择晚一帧才亮"的闪烁。
  if (pickTarget && pickTarget.nonce !== handledPickNonce && baseContent) {
    setHandledPickNonce(pickTarget.nonce);
    const picked = selectionFromPath(baseContent, pickTarget.path);
    if (picked) {
      setSelection(picked);
      setFocusedKey(treeKeyForSelection(picked));
      if (picked.kind !== "personal") {
        const key = entryKey(picked.field, picked.objectId);
        setCollapsedSections((previous) => {
          if (!previous.has(picked.field)) return previous;
          const next = new Set(previous);
          next.delete(picked.field);
          return next;
        });
        setExpandedEntries((previous) => {
          if (previous.has(key)) return previous;
          const next = new Set(previous);
          next.add(key);
          return next;
        });
      }
    }
  }

  // 选择上报（宿主可据此联动属性区；大纲自己已经用上了，不依赖宿主回传）。
  useEffect(() => {
    onSelectionChange?.(selection);
  }, [selection, onSelectionChange]);

  const expandedSections = useMemo(() => {
    const set = new Set<string>();
    for (const section of model.sections) {
      if (section.field && !collapsedSections.has(section.field)) set.add(section.field);
    }
    return set;
  }, [model.sections, collapsedSections]);

  const visibleKeys = useMemo(
    () => visibleTreeKeys(model, expandedSections, expandedEntries),
    [model, expandedSections, expandedEntries],
  );
  const activeKey = visibleKeys.includes(focusedKey) ? focusedKey : (visibleKeys[0] ?? "");

  const selectedEntry = useMemo(() => findOutlineEntry(model, selection), [model, selection]);
  const selectedPoint = useMemo(() => findOutlinePoint(model, selection), [model, selection]);
  const multiSelectedEntries = useMemo(() => {
    if (multiSelect.size === 0) return [];
    const found: OutlineEntry[] = [];
    for (const section of model.sections) {
      for (const entry of section.entries) {
        if (multiSelect.has(entryKey(entry.field, entry.objectId))) found.push(entry);
      }
    }
    return found;
  }, [model, multiSelect]);

  const focusTreeKey = useCallback(
    (key: string) => {
      setFocusedKey(key);
      // 键只含 [a-z0-9:_-]，可以直接放进属性选择器的引号里。
      treeRef.current?.querySelector<HTMLElement>(`[data-tree-key="${key}"]`)?.focus();
    },
    [treeRef],
  );

  const select = useCallback((next: OutlineSelection) => {
    setSelection(next);
    setFocusedKey(treeKeyForSelection(next));
  }, []);

  const toggleSection = useCallback((field: string) => {
    setCollapsedSections((previous) => {
      const next = new Set(previous);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const toggleEntry = useCallback((key: string) => {
    setExpandedEntries((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleMultiSelect = useCallback((entry: OutlineEntry) => {
    const key = entryKey(entry.field, entry.objectId);
    setMultiSelect((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearMultiSelect = useCallback(() => setMultiSelect(new Set()), []);

  const handleTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      // 排序手柄自己处理方向键/Enter/Esc（它需要阻止事件继续冒泡到树）。
      if (target?.closest(".resume-outline-handle")) return;
      const item = target?.closest<HTMLElement>("[data-tree-key]");
      const key = item?.dataset.treeKey ?? activeKey;
      if (!key) return;
      const index = visibleKeys.indexOf(key);
      switch (event.key) {
        case "ArrowDown":
          if (index >= 0 && index < visibleKeys.length - 1) {
            event.preventDefault();
            focusTreeKey(visibleKeys[index + 1]);
          }
          break;
        case "ArrowUp":
          if (index > 0) {
            event.preventDefault();
            focusTreeKey(visibleKeys[index - 1]);
          }
          break;
        case "Home":
          if (visibleKeys.length > 0) {
            event.preventDefault();
            focusTreeKey(visibleKeys[0]);
          }
          break;
        case "End":
          if (visibleKeys.length > 0) {
            event.preventDefault();
            focusTreeKey(visibleKeys[visibleKeys.length - 1]);
          }
          break;
        case "ArrowRight": {
          if (key.startsWith("section:")) {
            event.preventDefault();
            const field = key.slice("section:".length);
            if (collapsedSections.has(field)) toggleSection(field);
            else if (index >= 0 && index < visibleKeys.length - 1)
              focusTreeKey(visibleKeys[index + 1]);
          } else if (key.startsWith("entry:")) {
            event.preventDefault();
            const entry = findOutlineEntry(model, selectionForTreeKey(key));
            if (!entry || entry.points.length === 0) break;
            if (expandedEntries.has(key)) {
              if (index >= 0 && index < visibleKeys.length - 1)
                focusTreeKey(visibleKeys[index + 1]);
            } else {
              toggleEntry(key);
            }
          }
          break;
        }
        case "ArrowLeft": {
          if (key.startsWith("section:")) {
            event.preventDefault();
            const field = key.slice("section:".length);
            if (!collapsedSections.has(field)) toggleSection(field);
          } else if (key.startsWith("entry:")) {
            event.preventDefault();
            if (expandedEntries.has(key)) toggleEntry(key);
            else
              focusTreeKey(
                item?.parentElement?.closest<HTMLElement>("[data-tree-key]")?.dataset.treeKey ?? "",
              );
          } else if (key.startsWith("point:")) {
            event.preventDefault();
            const parts = key.split(":");
            focusTreeKey(`entry:${parts[1]}:${parts[2]}`);
          }
          break;
        }
        case "Enter": {
          if (key.startsWith("section:")) {
            event.preventDefault();
            toggleSection(key.slice("section:".length));
            break;
          }
          const next = selectionForTreeKey(key);
          if (next) {
            event.preventDefault();
            select(next);
          }
          break;
        }
        case " ": {
          if (key.startsWith("entry:")) {
            const entry = findOutlineEntry(model, selectionForTreeKey(key));
            if (entry) {
              event.preventDefault();
              toggleMultiSelect(entry);
            }
          } else {
            const next = selectionForTreeKey(key);
            if (next) {
              event.preventDefault();
              select(next);
            }
          }
          break;
        }
        default:
          break;
      }
    },
    [
      activeKey,
      collapsedSections,
      expandedEntries,
      focusTreeKey,
      model,
      select,
      toggleEntry,
      toggleMultiSelect,
      toggleSection,
      visibleKeys,
    ],
  );

  return {
    selection,
    selectedEntry,
    selectedPoint,
    multiSelectedEntries,
    visibleKeys,
    activeKey,
    collapsedSections,
    expandedEntries,
    select,
    toggleSection,
    toggleEntry,
    toggleMultiSelect,
    clearMultiSelect,
    handleTreeKeyDown,
  };
}
