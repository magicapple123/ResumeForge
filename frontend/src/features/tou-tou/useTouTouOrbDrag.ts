/** 投投悬浮球的拖拽、视口边界限制与四边吸附。 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { TouTouStatus } from "./touTouTypes";

/** 兜底尺寸：真实直径从元素上量——`≤767px` 时 CSS 会把它调成 56px。 */
const DEFAULT_ORB_SIZE = 64;
const DEFAULT_EDGE = 24;
/** 拖动时留在视口里的最小边距。 */
const VIEWPORT_MARGIN = 8;
/** 顶部让开应用头部的高度。 */
const HEADER_OFFSET = 64;

export interface TouTouOrbPosition {
  left: number | null;
  side: "left" | "right" | "top" | "bottom";
  top: number | null;
}

interface OrbMetrics {
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

/**
 * 从元素上量出球的实际尺寸与贴边边距。
 *
 * 以前这里是两个常量（64 / 24），而窄屏的 CSS 是 56 / 16：在那个断点下拖动后的
 * 夹取与吸附都会差 8px，球会贴不到边或者被算到视口外。
 */
function readOrbMetrics(button: HTMLButtonElement | null): OrbMetrics {
  if (!button) return { size: DEFAULT_ORB_SIZE, edge: DEFAULT_EDGE };
  const size = button.getBoundingClientRect().width || DEFAULT_ORB_SIZE;
  const declaredEdge = Number.parseFloat(
    window.getComputedStyle(button).getPropertyValue("--tt-edge"),
  );
  return {
    size,
    edge: Number.isFinite(declaredEdge) && declaredEdge > 0 ? declaredEdge : DEFAULT_EDGE,
  };
}

function clampTop(top: number, size: number): number {
  const maxTop = Math.max(HEADER_OFFSET, window.innerHeight - size - VIEWPORT_MARGIN);
  return Math.min(Math.max(HEADER_OFFSET, top), maxTop);
}

function clampLeft(left: number, size: number): number {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN);
  return Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft);
}

function nearestEdge(left: number, top: number, size: number): TouTouOrbPosition["side"] {
  const distances = {
    bottom: Math.max(0, window.innerHeight - (top + size)),
    left,
    right: Math.max(0, window.innerWidth - (left + size)),
    top: Math.max(0, top - HEADER_OFFSET),
  };
  return (Object.keys(distances) as TouTouOrbPosition["side"][]).reduce(
    (nearest, side) => (distances[side] < distances[nearest] ? side : nearest),
    "right",
  );
}

function snapToEdge(
  left: number,
  top: number,
  metrics: OrbMetrics,
): Pick<TouTouOrbPosition, "left" | "side" | "top"> {
  const { size, edge } = metrics;
  const side = nearestEdge(left, top, size);
  if (side === "left") return { left: edge, side, top };
  if (side === "right") {
    return { left: Math.max(edge, window.innerWidth - size - edge), side, top };
  }
  if (side === "top") return { left, side, top: HEADER_OFFSET };
  return { left, side, top: Math.max(HEADER_OFFSET, window.innerHeight - size - edge) };
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
    const handleResize = () => {
      const { size } = readOrbMetrics(buttonRef.current);
      setPosition((current) =>
        current.left === null
          ? current
          : {
              ...current,
              left: clampLeft(current.left, size),
              top: current.top === null ? null : clampTop(current.top, size),
            },
      );
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
    const fallbackLeft = position.left ?? window.innerWidth - metrics.edge - metrics.size;
    const fallbackTop = position.top ?? window.innerHeight - metrics.edge - metrics.size;
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
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) suppressClickRef.current = true;
      const nextLeft = clampLeft(origin.left + deltaX, metrics.size);
      const nextTop = clampTop(origin.top + deltaY, metrics.size);
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
      if (origin) {
        const currentLeft = dragPositionRef.current?.left ?? origin.left;
        const snapped = snapToEdge(
          currentLeft,
          dragPositionRef.current?.top ?? origin.top,
          metrics,
        );
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
