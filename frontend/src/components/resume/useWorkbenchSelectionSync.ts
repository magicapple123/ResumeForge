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
 *
 * ## 右栏定位是**一次性令牌**（2026-11-02 第二轮返工）
 *
 * `canvasReveal` 不是"由 selectedPath 派生"的：
 * 派生写法下 `selectedPath` 一变（纸面点击）令牌就换了路径，而 `nonce` 没变 —— 消费方 effect
 * 的 deps `[revealPath, revealNonce]` 因此**重跑一次**，把纸面又滚到刚点的那个字段上，
 * 用户看到的是"我点纸面，纸面自己滚了一下"。现在：
 * 1. 只有**非纸面**来源（结构树 / 中栏 chip / 条目排版面板）才写令牌；
 * 2. 令牌与当前选中不一致就作废（`canvasReveal === null`）：纸面点击换掉选中后，
 *    连"iframe 重载重放定位"那条订阅也一起拆掉，不会在用户编辑后把纸面拽回旧位置。
 */
import { useCallback, useState } from "react";

/** 选中来源：决定右栏纸面要不要跟着滚（纸面点击不滚，否则会和用户刚点的地方打架）。 */
export type SelectionSource = "paper" | "structure" | "editor";

/** 右栏纸面的一次定位请求（令牌：消费一次即随选中态变化作废）。 */
export interface CanvasRevealRequest {
  path: string;
  nonce: number;
}

export interface WorkbenchSelectionSync {
  selectedPath: string | null;
  multiSelectedPaths: string[];
  hoverPath: string | null;
  /** 纸面点击序号（结构树用它去重"同一路径连点两次"）。 */
  pickNonce: number;
  /** 中栏条目定位序号（任何来源的选中都 +1）。 */
  editorReveal: { path: string; nonce: number } | null;
  /** 右栏纸面定位请求（只由树/编辑器/面板来源写；纸面点击既不写也不续命）。 */
  canvasReveal: CanvasRevealRequest | null;
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
  // 右栏定位令牌：`nonce` 只增不减（保证"同一路径再点一次"也换 dep），`path` 单独存，
  // 这样纸面点击（不写这两个状态）不会把令牌换成新路径。
  const [canvasRevealNonce, setCanvasRevealNonce] = useState(0);
  const [canvasRevealPath, setCanvasRevealPath] = useState<string | null>(null);

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
    // 其余来源（结构树 / 条目排版面板 / 中栏编辑器）都要让纸面滚到选中项——**同一个令牌**
    // 是唯一出口。以前结构树自己在 `useStructurePanel` 里另存一份 reveal，两路 smooth 滚动
    // 会互相排队，先发起的那一路被后一帧覆盖，表现得像"没定位"。
    if (source === "paper") return;
    setCanvasRevealNonce((value) => value + 1);
    setCanvasRevealPath(path);
  }, []);

  const pickFromPaper = useCallback((path: string) => {
    setSelectedPath(path);
    setPickNonce((value) => value + 1);
    setEditorRevealNonce((value) => value + 1);
    // 刻意不写 `canvasRevealPath` / `canvasRevealNonce`：令牌与新的选中不一致后由下面
    // 的派生逻辑作废（既不滚纸面，也不留一条"iframe 重载就滚回去"的重放订阅）。
  }, []);

  return {
    selectedPath,
    multiSelectedPaths,
    hoverPath,
    pickNonce,
    editorReveal: selectedPath ? { path: selectedPath, nonce: editorRevealNonce } : null,
    // 令牌只在"它指向的正是当前选中"时有效：纸面点击换了选中，令牌立刻失效。
    canvasReveal:
      canvasRevealPath !== null && canvasRevealPath === selectedPath
        ? { path: canvasRevealPath, nonce: canvasRevealNonce }
        : null,
    selectPath,
    pickFromPaper,
    setMultiSelectedPaths,
    setHoverPath,
  };
}
