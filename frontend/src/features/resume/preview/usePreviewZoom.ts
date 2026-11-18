// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的缩放状态（从 `ResumePreview` 拆出）。
 *
 * 为什么单独成文件：`ResumePreview.tsx` 贴着单文件 500 行硬预算，而"缩放系数 + Ctrl 滚轮 +
 * 大屏上限"是一整块**与版面测量无关**的状态，拆出来后 W15 的缩放档位才有地方接。
 *
 * 2026-11-18（QW-7）改成"连续 + 可见百分比"：
 * - Ctrl/Cmd + 滚轮按 `deltaY` 指数缩放（`current * exp(-deltaY * K)`），不再每下跳 10%；
 * - `+/-` 按**可见百分比**放大/缩小 5%（可见比例 = 系数 × fitScale，所以系数本身 ×/÷1.05
 *   就是屏幕上的 5%，与窗口宽无关）；
 * - `deltaMode` 归一成像素：行模式 ×16、页模式 ×800；`|deltaY| <= |deltaX|` 时视为触控板
 *   横滑，不缩放（但仍由调用方拦掉浏览器自己的 Ctrl+滚轮页面缩放）；
 * - 边界停在 `MIN_ZOOM / MAX_ZOOM`，不弹回、不跳档。
 *
 * 锚点补偿（缩放后光标下的文字不动）在 `ResumePreview` 里做：它需要滚动容器与 scale-box
 * 的几何，这里只负责"下一个系数是多少"。
 */
import { useCallback, useEffect, useState } from "react";
import { MAX_FIT_SCALE_DEFAULT, MAX_ZOOM, MIN_ZOOM } from "./config";

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

/** 滚轮指数缩放的系数。拖动一小段滚轮 ≈ 1—2%，快速滚动会指数级逼近边界。 */
export const WHEEL_ZOOM_K = 0.0015;
/** `DOM_DELTA_LINE` 下 `deltaY` 是行数：一行按 16px 折算（Chrome 的默认可视行高）。 */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** `DOM_DELTA_PAGE` 下 `deltaY` 是页数：按一屏 A4 的未缩放高度折算，宁可偏大也不丢手感。 */
export const WHEEL_PAGE_HEIGHT_PX = 800;
/** `+/-` 的可见缩放比例：屏幕上的比例变化 5%。 */
export const ZOOM_STEP_FACTOR = 1.05;

export interface WheelZoomEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
  /** 触控板横滑时为非 0；横向分量更大时不该缩放。 */
  deltaX?: number;
  /** `0` = 像素（默认）、`1` = 行、`2` = 页。 */
  deltaMode?: number;
}

/**
 * 把不同 `deltaMode` 的滚轮增量折算成像素。
 *
 * Firefox（`DOM_DELTA_LINE`）下不折算会快几十倍：一次滚轮 `deltaY` 是 3—5 行，直接当像素
 * 用几乎不动；反过来若把像素当行数又会一下冲到边界。页模式（少见）按 800px 一页折算。
 */
export function wheelPixels(event: WheelZoomEvent): number {
  const mode = event.deltaMode ?? 0;
  if (mode === 1) return event.deltaY * WHEEL_LINE_HEIGHT_PX;
  if (mode === 2) return event.deltaY * WHEEL_PAGE_HEIGHT_PX;
  return event.deltaY;
}

/** 下一次缩放系数：按指数连续变化，并夹在 `[MIN_ZOOM, MAX_ZOOM]`。 */
export function nextWheelZoom(current: number, event: WheelZoomEvent): number {
  const pixels = wheelPixels(event);
  if (pixels === 0) return current;
  return clampZoom(current * Math.exp(-pixels * WHEEL_ZOOM_K));
}

export interface PreviewZoom {
  /** 缩放系数：1 = 按 fit 比例，>1 放大，<1 缩小。 */
  zoom: number;
  setZoom: (next: number) => void;
  /** 按**可见百分比**缩放：`factor = 1.05` 即屏幕上放大 5%，与 fitScale 无关。 */
  zoomByFactor: (factor: number) => void;
  resetZoom: () => void;
  /** Ctrl/Cmd + 滚轮：返回是否消费了这次事件（消费后调用方要 preventDefault）。 */
  zoomByWheel: (event: WheelZoomEvent) => boolean;
}

/** 缩放状态。`initial` 只为测试与"记住上次缩放"之类的将来需求留口。 */
export function usePreviewZoom(initial = 1): PreviewZoom {
  const [zoom, setZoomState] = useState(() => clampZoom(initial));

  const setZoom = useCallback((next: number) => setZoomState(clampZoom(next)), []);
  const zoomByFactor = useCallback((factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    setZoomState((current) => clampZoom(current * factor));
  }, []);
  const resetZoom = useCallback(() => setZoomState(1), []);
  const zoomByWheel = useCallback((event: WheelZoomEvent): boolean => {
    if (!event.ctrlKey && !event.metaKey) return false;
    const horizontal = event.deltaX ?? 0;
    // 触控板横滑不该缩放：只有纵向分量的量级更大时才消费这次事件。
    if (Math.abs(event.deltaY) <= Math.abs(horizontal)) return false;
    if (wheelPixels(event) === 0) return false;
    setZoomState((current) => nextWheelZoom(current, event));
    return true;
  }, []);

  return { zoom, setZoom, zoomByFactor, resetZoom, zoomByWheel };
}
