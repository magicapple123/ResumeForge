// SPDX-License-Identifier: Apache-2.0
/**
 * 投投悬浮球的拖拽、视口边界限制与四边吸附（P1-4）。
 *
 * 一条硬约束：**贴边缝隙只有一个数**（`edge`，默认 2px，来自 CSS 的 `--tt-edge`）。
 * 以前这里有三个各说各话的常量——`--tt-edge: 24px`、`VIEWPORT_MARGIN = 8`、
 * `HEADER_OFFSET = 64`——结果四边都贴不到边（左/右/下恒 24px、顶恒 64px），
 * 而且窄屏 CSS 换 16px 时夹取还按 24px 算，球会贴歪。现在全部收敛到 `edge`。
 *
 * 第二个约束：**窗口尺寸变化时按"记住的那条边"重钉**，不重算最近边。
 * 重算会让球在缩放时莫名其妙跳边（比如本来贴右，视口变窄后离左更近，直接飞过去）。
 * 除了 `resize`，还要订阅 `visualViewport`——浏览器双指/页面缩放时不一定派发 window resize。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { TouTouStatus } from "./touTouTypes";

/** 兜底尺寸：真实直径从元素上量——`≤767px` 时 CSS 会把它调成 56px。 */
const DEFAULT_ORB_SIZE = 64;
/** 兜底贴边缝隙：与 CSS `--tt-edge` 同值。读不到自定义属性时用它（jsdom / 首帧）。 */
const DEFAULT_EDGE = 2;
/** 拖动超过这个位移就不算点击（避免拖完松手时误触打开助手卡）。 */
const DRAG_CLICK_THRESHOLD = 4;

/** 球贴在视口的哪条边上（也是 CSS `is-edge-*` 类名的来源）。 */
export type TouTouOrbSide = "left" | "right" | "top" | "bottom";

export interface TouTouOrbPosition {
  left: number | null;
  side: TouTouOrbSide;
  top: number | null;
}

/** 量出来的球体几何：直径 + 贴边缝隙。两者都不允许在链路里各自改口。 */
export interface OrbMetrics {
  /** 悬浮球直径。 */
  size: number;
  /** 贴边时留出的边距，与 CSS 的 `--tt-edge` 保持一致。 */
  edge: number;
}

interface PointerOrigin {
  left: number;
  pointerX: number;
  pointerY: number;
  top: number;
}

interface UseTouTouOrbDragOptions {
  scheduleIdle: (delay: number) => void;
  setVisualStatus: (status: TouTouStatus) => void;
  wake: () => void;
}

/** 视口尺寸。几何一律按**布局视口**算：`position: fixed` 的参照物就是它。 */
interface ViewportSize {
  width: number;
  height: number;
}

function readViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

/**
 * 从元素上量出球的实际尺寸与贴边边距。
 *
 * 以前这里是两个常量（64 / 24），而窄屏的 CSS 是 56 / 16：在那个断点下拖动后的
 * 夹取与吸附都会差 8px，球会贴不到边或者被算到视口外。
 */
export function readOrbMetrics(button: HTMLButtonElement | null): OrbMetrics {
  if (!button) return { size: DEFAULT_ORB_SIZE, edge: DEFAULT_EDGE };
  const size = button.getBoundingClientRect().width || DEFAULT_ORB_SIZE;
  const declaredEdge = Number.parseFloat(
    window.getComputedStyle(button).getPropertyValue("--tt-edge"),
  );
  return {
    size,
    edge: Number.isFinite(declaredEdge) && declaredEdge >= 0 ? declaredEdge : DEFAULT_EDGE,
  };
}

/** 拖动过程中的横向夹取：左右各留 `edge`。 */
function clampLeft(left: number, metrics: OrbMetrics): number {
  const { size, edge } = metrics;
  return clamp(left, edge, readViewport().width - size - edge);
}

/** 拖动过程中的纵向夹取：上下同样各留 `edge`（顶部不再特殊让开 64px 页头）。 */
function clampTop(top: number, metrics: OrbMetrics): number {
  const { size, edge } = metrics;
  return clamp(top, edge, readViewport().height - size - edge);
}

/**
 * 离哪条边最近（松手时吸附到它）。四边等权，不存在"顶部要减 64"的特例。
 *
 * `prefer` 只在**完全等距**时决胜（贴边缝隙是 2px，沿边拖动时"同时贴两条边"是常态）：
 * 竖向拖动更该吸到上/下边，横向拖动更该吸到左/右边。默认横向，与历史行为一致。
 */
export function nearestEdge(
  left: number,
  top: number,
  size: number,
  prefer: "horizontal" | "vertical" = "horizontal",
): TouTouOrbSide {
  const viewport = readViewport();
  const distances: Record<TouTouOrbSide, number> = {
    bottom: Math.max(0, viewport.height - (top + size)),
    left,
    right: Math.max(0, viewport.width - (left + size)),
    top,
  };
  const order: TouTouOrbSide[] =
    prefer === "vertical" ? ["top", "bottom", "left", "right"] : ["right", "left", "bottom", "top"];
  return order.reduce((nearest, side) => (distances[side] < distances[nearest] ? side : nearest));
}

/**
 * 把球钉在指定的一条边上（P1-4 的核心）。
 *
 * 与 `snapToEdge` 的区别：这里**不听几何**，`side` 是外部给的既定事实。窗口缩放时
 * 用它按记住的边重钉，球才不会跳边；另一轴保持原值（越界就夹回视口内）。
 */
export function pinToSide(
  side: TouTouOrbSide,
  left: number,
  top: number,
  metrics: OrbMetrics,
): Pick<TouTouOrbPosition, "left" | "side" | "top"> {
  const pinnedLeft = clampLeft(left, metrics);
  const pinnedTop = clampTop(top, metrics);
  if (side === "left") return { left: metrics.edge, side, top: pinnedTop };
  if (side === "right") {
    const { size, edge } = metrics;
    return { left: Math.max(edge, readViewport().width - size - edge), side, top: pinnedTop };
  }
  if (side === "top") return { left: pinnedLeft, side, top: metrics.edge };
  const { size, edge } = metrics;
  return { left: pinnedLeft, side, top: Math.max(edge, readViewport().height - size - edge) };
}

/** 松手时吸附到最近的一条边：先定边，再交给 `pinToSide` 落位。 */
function snapToEdge(
  left: number,
  top: number,
  metrics: OrbMetrics,
  prefer: "horizontal" | "vertical",
): Pick<TouTouOrbPosition, "left" | "side" | "top"> {
  return pinToSide(nearestEdge(left, top, metrics.size, prefer), left, top, metrics);
}

export function useTouTouOrbDrag({ scheduleIdle, setVisualStatus, wake }: UseTouTouOrbDragOptions) {
  const [position, setPosition] = useState<TouTouOrbPosition>({
    left: null,
    side: "right",
    top: null,
  });
  const [dragging, setDragging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pointerOriginRef = useRef<PointerOrigin | null>(null);
  const dragPositionRef = useRef<{ left: number; top: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    // 视口变化只有一个反应：**按记住的边重钉**。不重算最近边（会跳边），
    // 也不重置成 null（那会让球跳回 CSS 默认的右下角）。
    const handleViewportChange = () => {
      const metrics = readOrbMetrics(buttonRef.current);
      setPosition((current) => {
        // 还没拖过：位置交给 CSS（right/bottom + --tt-edge），天然就是贴边的。
        if (current.left === null || current.top === null) return current;
        const pinned = pinToSide(current.side, current.left, current.top, metrics);
        if (pinned.left === current.left && pinned.top === current.top) return current;
        return { ...current, ...pinned };
      });
    };
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", handleViewportChange);
    // 页面缩放（含双指缩放）不一定派发 window resize，`visualViewport` 才一定。
    visualViewport?.addEventListener("resize", handleViewportChange);
    visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      visualViewport?.removeEventListener("resize", handleViewportChange);
      visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  const shellStyle = useMemo<CSSProperties>(() => {
    if (position.left === null || position.top === null) return {};
    return {
      bottom: "auto",
      left: position.left,
      right: "auto",
      top: position.top,
    };
  }, [position.left, position.top]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    wake();
    const metrics = readOrbMetrics(buttonRef.current);
    const rect = buttonRef.current?.getBoundingClientRect();
    const viewport = readViewport();
    const fallbackLeft = position.left ?? viewport.width - metrics.edge - metrics.size;
    const fallbackTop = position.top ?? viewport.height - metrics.edge - metrics.size;
    pointerOriginRef.current = {
      left: rect?.left || fallbackLeft,
      pointerX: event.clientX,
      pointerY: event.clientY,
      top: rect?.top || fallbackTop,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    setVisualStatus("curious");

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const origin = pointerOriginRef.current;
      if (!origin) return;
      const deltaX = moveEvent.clientX - origin.pointerX;
      const deltaY = moveEvent.clientY - origin.pointerY;
      if (Math.abs(deltaX) > DRAG_CLICK_THRESHOLD || Math.abs(deltaY) > DRAG_CLICK_THRESHOLD) {
        suppressClickRef.current = true;
      }
      const nextLeft = clampLeft(origin.left + deltaX, metrics);
      const nextTop = clampTop(origin.top + deltaY, metrics);
      dragPositionRef.current = { left: nextLeft, top: nextTop };
      setPosition((current) => ({
        ...current,
        left: nextLeft,
        side: nearestEdge(nextLeft, nextTop, metrics.size),
        top: nextTop,
      }));
    };
    const handleUp = () => {
      const origin = pointerOriginRef.current;
      const dragged = dragPositionRef.current;
      // 没真正移动过（纯点击）就不吸附：那颗球本来就已经贴边，重算只会在"同时贴两条边"
      // 的角上无缘无故换一次朝向。
      if (origin && dragged) {
        const deltaX = dragged.left - origin.left;
        const deltaY = dragged.top - origin.top;
        const prefer = Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
        const snapped = snapToEdge(dragged.left, dragged.top, metrics, prefer);
        setPosition((current) => ({
          ...current,
          ...snapped,
        }));
      }
      pointerOriginRef.current = null;
      dragPositionRef.current = null;
      setDragging(false);
      scheduleIdle(1_500);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  return {
    buttonRef,
    dragging,
    handlePointerDown,
    position,
    shellStyle,
    suppressClickRef,
  };
}
