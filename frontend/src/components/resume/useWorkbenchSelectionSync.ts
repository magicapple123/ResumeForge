// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的"选中态"唯一出口（2026-10-31 R-14 抽出）。
 *
 * 为什么单独一层：`selectedPath` 有四个写入方（纸面点击、结构树 / 条目排版面板、中栏编辑器、
 * 页签内的采纳动作），而两列各自要**按来源**决定滚不滚——纸面点击只该让中栏定位，
 * 树/编辑器选中则两列都动。若把两个 nonce 写在组件里，每加一个选中来源都要在四处补计数。
 *
 * `pickNonce` 与 `editorRevealNonce` 的区别：前者只服务结构树的"同路径连点也要重新展开+定位"，
 * 后者服务中栏条目的滚动（任何来源都递增，连点纸面同一字段也要再滚一次）。
 */
import { useCallback, useState } from "react";

/** 选中来源：决定右栏纸面要不要跟着滚（纸面点击不滚，否则会和用户刚点的地方打架）。 */
export type SelectionSource = "paper" | "structure" | "editor";

export interface WorkbenchSelectionSync {
  selectedPath: string | null;
  multiSelectedPaths: string[];
  hoverPath: string | null;
  /** 纸面点击序号（结构树用它去重"同一路径连点两次"）。 */
  pickNonce: number;
  /** 中栏条目定位序号（任何来源的选中都 +1）。 */
  editorReveal: { path: string; nonce: number } | null;
  /** 右栏纸面定位序号（只由树/编辑器/面板来源 +1）。 */
  canvasReveal: { path: string; nonce: number } | null;
  selectPath: (path: string | null, source?: SelectionSource) => void;
  pickFromPaper: (path: string) => void;
  setMultiSelectedPaths: (paths: string[]) => void;
  setHoverPath: (path: string | null) => void;
}

/**
 * @param owner 文档身份（`resumeId|open`）：切简历 / 重开工作台时清空多选，
 *   因为多选是"当前这份文档"的批量目标，跨文档残留会把样式写到别的条目上。
 */
export function useWorkbenchSelectionSync(owner: string): WorkbenchSelectionSync {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [multiSelectedPaths, setMultiSelectedPaths] = useState<string[]>([]);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [pickNonce, setPickNonce] = useState(0);
  const [editorRevealNonce, setEditorRevealNonce] = useState(0);
  const [canvasRevealNonce, setCanvasRevealNonce] = useState(0);

  // 渲染期对齐文档身份（不在 effect 里 setState，避免多出一拍陈旧选中态）。
  const [prevOwner, setPrevOwner] = useState(owner);
  if (prevOwner !== owner) {
    setPrevOwner(owner);
    setMultiSelectedPaths([]);
  }

  const selectPath = useCallback((path: string | null, source: SelectionSource = "editor") => {
    setSelectedPath(path);
    // 每次显式选中都递增：同路径连点也要重新定位（与纸面点击同一口径）。
    setEditorRevealNonce((value) => value + 1);
    // 纸面点击不滚右栏：用户刚点的元素本来就在眼前，再滚一次只会把纸面挪走。
    // 结构树自己已有 `reveal`（useStructurePanel），这里只补"编辑器/面板选中 → 纸面跟随"。
    if (source === "editor") setCanvasRevealNonce((value) => value + 1);
  }, []);

  const pickFromPaper = useCallback((path: string) => {
    setSelectedPath(path);
    setPickNonce((value) => value + 1);
    setEditorRevealNonce((value) => value + 1);
  }, []);

  return {
    selectedPath,
    multiSelectedPaths,
    hoverPath,
    pickNonce,
    editorReveal: selectedPath ? { path: selectedPath, nonce: editorRevealNonce } : null,
    canvasReveal: selectedPath ? { path: selectedPath, nonce: canvasRevealNonce } : null,
    selectPath,
    pickFromPaper,
    setMultiSelectedPaths,
    setHoverPath,
  };
}
