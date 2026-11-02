// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台右栏纸面的"选中 / 悬停"高亮接线（2026-11 从 `ResumeWorkbenchV2` 抽出）。
 *
 * 为什么单独一层：这段派生 + 两次 `useCanvasPathHighlight` 只关系"纸面怎么被涂色"，
 * 与工作台的保存 / 历史 / 版式无关；留在壳组件里既顶着 500 行预算，也让问题 7 的
 * 两档口径（叶子 20% / 容器 ≤5%）散落在业务代码中间。
 *
 * 高亮目标由路径派生（`highlightTargetsForPath`）：板块 = `.section[data-section]`、
 * 条目 = `.entry[data-object-id]`、字段 = `[data-resume-path]` 叶子。**问题 7** 的要点是
 * 选中板块/条目时不再把内部几十个字段逐个涂色，而是画整块容器。
 *
 * 两档用不同 `<style>` id 各画一层（R-14）：
 * - 选中档：20% 底色 + 2px 描边（叶子）/ 淡底 + 1px 外框（容器）；
 * - 悬停档：14% / 1px，扫过时不会把刚选中的那一行擦淡。
 * `reveal` 只吃编辑器/面板来源的定位令牌（纸面点击不滚纸面，见 useWorkbenchSelectionSync）。
 */
import { useMemo } from "react";
import type { CanvasRevealRequest } from "../useWorkbenchSelectionSync";
import {
  highlightTargetsForPath,
  STRUCTURE_HIGHLIGHT_PAINT_SELECTED,
  STRUCTURE_HIGHLIGHT_SELECTED_STYLE_ID,
  useCanvasPathHighlight,
} from "./structureHighlight";

export interface StructureHighlightTargetsOptions {
  /** 当前选中路径（`section.…` / `section.entryId` / `section.entryId.field` / `header.…`）。 */
  selectedPath: string | null;
  /** 结构树 / 中栏 chip 的悬停路径；与选中互不影响。 */
  hoverPath: string | null;
  /** 右栏画布容器节点（晚一帧就绪也可以，hook 内部有界重试）。 */
  container: HTMLElement | null;
  /** 一次性定位令牌：只在非纸面来源的选中上出现，`null` = 只换高亮不滚动。 */
  reveal: CanvasRevealRequest | null;
}

/**
 * 把当前选中/悬停画到右栏纸面（选中档 + 悬停档各一层）。
 *
 * @param options 见 {@link StructureHighlightTargetsOptions}。
 */
export function useStructureHighlightTargets({
  selectedPath,
  hoverPath,
  container,
  reveal,
}: StructureHighlightTargetsOptions): void {
  // 路径 → 高亮目标：只随路径变化重算（拖版式/翻页不该重建目标数组）。
  const selectedTargets = useMemo(() => highlightTargetsForPath(selectedPath), [selectedPath]);
  const hoverTargets = useMemo(() => highlightTargetsForPath(hoverPath), [hoverPath]);
  // 选中档：容器级（板块/条目）与叶子级用两套声明，见 STRUCTURE_HIGHLIGHT_PAINT_SELECTED。
  useCanvasPathHighlight({
    targets: selectedTargets,
    container,
    reveal,
    styleId: STRUCTURE_HIGHLIGHT_SELECTED_STYLE_ID,
    paint: STRUCTURE_HIGHLIGHT_PAINT_SELECTED,
  });
  // 悬停档：默认 style id + 默认（更淡）声明，与选中档互不擦除。
  useCanvasPathHighlight({ targets: hoverTargets, container });
}
