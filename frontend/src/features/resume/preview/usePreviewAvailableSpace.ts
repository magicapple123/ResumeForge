// SPDX-License-Identifier: Apache-2.0
/**
 * 预览**可用空间**的测量（从 `ResumePreview.tsx` 拆出，文件行预算）。
 *
 * 两条口径，语义与拆分前逐字一致：
 * - 宿主给了 `availableHeight`（制作台右栏）→ 以纸面那一层量到的高度为准（已扣掉工具条/
 *   提示条/缩放条），量不到时退回宿主给的总预算；宽度永远量纸面视口本身；
 * - 宿主没给（列表页主预览）→ 用窗口高度 × 比例估算，并夹在最小高度与"窗口高 − 预留"之间。
 *
 * 与刷新恢复**分开**（2026-10-29）：依赖 `updateAvailableSpace` 的 effect 会随
 * `bodyHeight` 变化重建——头部一变高（提示条出现、工具条换行）就重新注册 observer 与监听，
 * fit 比例也跟着抖一次。所以这里只负责"量"，刷新补偿在 `useStablePreviewScale`。
 */
import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import {
  MIN_PREVIEW_HEIGHT,
  PREVIEW_BOTTOM_RESERVE,
  PREVIEW_HEIGHT_RATIO,
  type AvailableSpace,
} from "./config";

export interface PreviewAvailableSpaceOptions {
  /** 纸面视口（`.resume-preview-viewport`）：量它的 clientWidth。 */
  containerRef: RefObject<HTMLElement | null>;
  /** 宿主给的整块可用高度（制作台右栏）；缺省 = 主预览的窗口比例口径。 */
  availableHeight?: number;
  /** 纸面那一层量出来的真实可用高度；0 = 还没量到。 */
  bodyHeight: number;
  /** 首次布局尚未测量时的占位高度。 */
  height?: number;
  /** 纸面总高（多页之和），没给 height 时作为占位。 */
  paperHeight: number;
}

export function usePreviewAvailableSpace({
  containerRef,
  availableHeight,
  bodyHeight,
  height,
  paperHeight,
}: PreviewAvailableSpaceOptions): AvailableSpace {
  const [availableSpace, setAvailableSpace] = useState<AvailableSpace>({
    width: 0,
    height: height ?? paperHeight,
  });

  const updateAvailableSpace = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (availableHeight !== undefined) {
      setAvailableSpace({
        width: container.clientWidth,
        height: bodyHeight > 0 ? bodyHeight : Math.max(1, Math.round(availableHeight)),
      });
      return;
    }
    const viewportHeight =
      typeof window === "undefined" ? (height ?? paperHeight) : window.innerHeight;
    const budget = Math.round(viewportHeight * PREVIEW_HEIGHT_RATIO);
    const ceiling = Math.max(MIN_PREVIEW_HEIGHT, viewportHeight - PREVIEW_BOTTOM_RESERVE);
    setAvailableSpace({
      width: container.clientWidth,
      height: Math.min(ceiling, Math.max(MIN_PREVIEW_HEIGHT, budget)),
    });
  }, [availableHeight, bodyHeight, containerRef, height, paperHeight]);

  useEffect(() => {
    updateAvailableSpace();
    const container = containerRef.current;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAvailableSpace);
    if (container) observer?.observe(container);
    window.addEventListener("resize", updateAvailableSpace);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateAvailableSpace);
    };
  }, [containerRef, updateAvailableSpace]);

  return availableSpace;
}
