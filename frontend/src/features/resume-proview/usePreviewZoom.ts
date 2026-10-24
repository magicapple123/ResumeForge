// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的缩放状态（从 `ResumePreview` 拆出）。
 *
 * 为什么单独成文件：`ResumePreview.tsx` 贴着单文件 500 行硬预算，而"缩放系数 + Ctrl 滚轮 +
 * 大屏上限"是一整块**与版面测量无关**的状态，拆出来后 W15 的缩放档位才有地方接。
 *
 * 行为与拆分前逐字一致：
 * - 系数夹在 [0.5, MAX_ZOOM]（`resume-preview/config` 的既有常量）；
 * - Ctrl/Cmd + 滚轮一次 10%，非 Ctrl 滚轮不动（交给外层滚动）；
 * - 大屏上限 `--rf-a4-max-fit` 在外接屏 / 改窗口后重新读（跨 1920 断点）。
 */
import { useCallback, useEffect, useState } from "react";
import { MAX_FIT_SCALE_DEFAULT, MAX_ZOOM, MIN_ZOOM } from "../../components/resume-preview/config";

/** 读 `--rf-a4-max-fit`：大屏（≥1920）允许放大到 1.35，其余档位保持"永不放大"。 */
export function readMaxFitScale(): number {
  if (typeof document === "undefined") return MAX_FIT_SCALE_DEFAULT;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue("--rf-a4-max-fit");
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : MAX_FIT_SCALE_DEFAULT;
}

/** 大屏放大上限（跨断点自动同步）。 */
export function useMaxFitScale(): number {
  // 惰性初始化而不是 effect：首帧就要有正确的上限，否则大屏会先画一张小纸再跳大。
  const [maxFitScale, setMaxFitScale] = useState(readMaxFitScale);
  useEffect(() => {
    const sync = () => setMaxFitScale(readMaxFitScale());
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return maxFitScale;
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export interface PreviewZoom {
  /** 缩放系数：1 = 按 fit 比例，>1 放大，<1 缩小。 */
  zoom: number;
  setZoom: (next: number) => void;
  adjustZoom: (delta: number) => void;
  resetZoom: () => void;
  /** Ctrl/Cmd + 滚轮：返回是否消费了这次事件（消费后调用方要 preventDefault）。 */
  zoomByWheel: (event: { ctrlKey: boolean; metaKey: boolean; deltaY: number }) => boolean;
}

/** 缩放状态。`initial` 只为测试与"记住上次缩放"之类的将来需求留口。 */
export function usePreviewZoom(initial = 1): PreviewZoom {
  const [zoom, setZoomState] = useState(() => clampZoom(initial));

  const setZoom = useCallback((next: number) => setZoomState(clampZoom(next)), []);
  const adjustZoom = useCallback((delta: number) => {
    setZoomState((current) => clampZoom(current + delta));
  }, []);
  const resetZoom = useCallback(() => setZoomState(1), []);
  const zoomByWheel = useCallback(
    (event: { ctrlKey: boolean; metaKey: boolean; deltaY: number }): boolean => {
      if (!event.ctrlKey && !event.metaKey) return false;
      if (event.deltaY === 0) return false;
      const direction = event.deltaY > 0 ? -1 : 1;
      setZoomState((current) => clampZoom(current + direction * 0.1));
      return true;
    },
    [],
  );

  return { zoom, setZoom, adjustZoom, resetZoom, zoomByWheel };
}
