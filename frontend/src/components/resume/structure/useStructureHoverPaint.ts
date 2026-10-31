// SPDX-License-Identifier: Apache-2.0
/**
 * 结构树的「悬停高亮」注入（从 useStructurePanel 拆出，保持单文件行预算）。
 *
 * 树有 160+ 行；若每次 mouseenter/leave 都改 React state，整个面板会重渲染并重挂
 * iframe 高亮 Observer，滚轮经过行时会稳定掉到 100ms+ 一帧。这里用 ref + 直接写
 * iframe <style>，把高频路径完全移出 React 渲染。
 */
import { useCallback, useRef } from "react";
import type { StructureNode } from "../../../features/resume-document/summarize";
import {
  buildStructureHighlightCss,
  highlightTargetsForNode,
  paintStructureHighlight,
  type HighlightTarget,
} from "./structureHighlight";

export function useStructureHoverPaint(
  container: HTMLElement | null | undefined,
  onHoverPath?: (path: string | null) => void,
) {
  const hoveredNodeRef = useRef<StructureNode | null>(null);
  const selectedTargetsRef = useRef<readonly HighlightTarget[]>([]);

  const handleRowHover = useCallback(
    (node: StructureNode | null) => {
      hoveredNodeRef.current = node;
      onHoverPath?.(node?.path ?? null);
      const targets = node ? highlightTargetsForNode(node) : selectedTargetsRef.current;
      paintStructureHighlight(container, buildStructureHighlightCss(targets));
    },
    [container, onHoverPath],
  );

  /** 选中变化时记下目标，并只在没有 hover 时重画；hover 期间不抢画。 */
  const syncSelectedTargets = useCallback(
    (targets: readonly HighlightTarget[]) => {
      selectedTargetsRef.current = targets;
      if (!hoveredNodeRef.current) {
        paintStructureHighlight(container, buildStructureHighlightCss(targets));
      }
    },
    [container],
  );

  return { handleRowHover, syncSelectedTargets };
}
