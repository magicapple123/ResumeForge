// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的**草稿 / 精确两套缩放**（Q18/Q21，2026-10-31）。
 *
 * 背景：曾经草稿与精确共用一个 `zoom`——草稿放大到 200% 后切精确，精确预览继承 200%
 * （纸比相框宽、横向溢出）；精确里调缩放又会反过来影响草稿。现在两边各一套状态，
 * 且**进入精确口径时按「适应画布」初始化**（精确的 1 = 纸宽等于相框宽）。
 *
 * 从 `ResumePreview.tsx` 拆出（文件行预算）：这段只是"两套缩放 + 当前口径取哪一套 +
 * 进入精确时的复位守卫"，与版面测量、iframe、缩放条渲染都无关，是独立可测的一小块。
 */
import { useState } from "react";
import type { PreviewMode } from "./config";
import { usePreviewZoom } from "../../features/resume-proview/usePreviewZoom";

export interface PreviewZoomPair {
  /** 草稿口径的缩放状态（几何计算、fit 补偿只认它）。 */
  draftZoom: ReturnType<typeof usePreviewZoom>;
  /** 精确口径的缩放状态（= PDF 纸面比例，1 = 适应画布）。 */
  exactZoom: ReturnType<typeof usePreviewZoom>;
  /** 当前可见口径的缩放（缩放条 / Ctrl+滚轮 / 快捷键只作用于这一档）。 */
  zoom: ReturnType<typeof usePreviewZoom>;
}

export function usePreviewZoomPair(activeMode: PreviewMode): PreviewZoomPair {
  const draftZoom = usePreviewZoom();
  const exactZoom = usePreviewZoom();
  const exactActive = activeMode === "exact";
  /**
   * 进入精确口径 = 按「适应画布」初始化：纸宽恰好等于相框宽，默认没有横向溢出。
   * 用"渲染期对齐上一次口径"的写法（项目里同款，如 `ResumeWorkbenchV2` 的多选归属），
   * 而不是在 effect 里同步 setState——那一拍用户会先看到继承来的放大比例，再被跳回去。
   */
  const [prevMode, setPrevMode] = useState(activeMode);
  if (prevMode !== activeMode) {
    setPrevMode(activeMode);
    if (exactActive) exactZoom.resetZoom();
  }
  return {
    draftZoom,
    exactZoom,
    zoom: exactActive ? exactZoom : draftZoom,
  };
}
