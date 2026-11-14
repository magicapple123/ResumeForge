// SPDX-License-Identifier: Apache-2.0
/** One viewport controls both SVG edges and nodes; wheel cancellation must be native. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

export interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const PAN_STEP = 40;
const DRAG_THRESHOLD = 4;

export function zoomGraphAt(
  view: GraphViewport,
  scale: number,
  px: number,
  py: number,
): GraphViewport {
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale * 10) / 10));
  const ratio = nextScale / view.scale;
  return { x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio, scale: nextScale };
}

export function useGraphViewport(width: number, height: number, active: boolean) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [view, setView] = useState<GraphViewport>({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{
    pointerId: number;
    px: number;
    py: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const fit = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, (surface.clientWidth - 56) / width, (surface.clientHeight - 56) / height),
    );
    setView({
      x: (surface.clientWidth - width * scale) / 2,
      y: (surface.clientHeight - height * scale) / 2,
      scale,
    });
  }, [width, height]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!active || !surface) return;
    const frame = requestAnimationFrame(() => {
      if (!initialized.current) {
        fit();
        initialized.current = true;
      }
    });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        if (event.deltaY === 0) return;
        setView((current) =>
          zoomGraphAt(
            current,
            current.scale + (event.deltaY < 0 ? 0.1 : -0.1),
            event.clientX - rect.left,
            event.clientY - rect.top,
          ),
        );
      } else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1;
        setView((current) => ({
          ...current,
          x: current.x - event.deltaX * unit,
          y: current.y - event.deltaY * unit,
        }));
      }
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener("wheel", onWheel);
    };
  }, [active, fit]);

  const zoom = (step: number) => {
    const surface = surfaceRef.current;
    if (surface)
      setView((current) =>
        zoomGraphAt(
          current,
          current.scale + step,
          surface.clientWidth / 2,
          surface.clientHeight / 2,
        ),
      );
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    drag.current = {
      pointerId: event.pointerId,
      px: event.clientX,
      py: event.clientY,
      x: view.x,
      y: view.y,
      moved: false,
    };
    if (!(event.target as Element).closest(".rf-job-graph-node"))
      event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.px;
    const dy = event.clientY - start.py;
    if (!start.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    start.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setView((current) => ({ ...current, x: start.x + dx, y: start.y + dy }));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") zoom(0.1);
    else if (event.key === "-") zoom(-0.1);
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const x = event.key === "ArrowLeft" ? PAN_STEP : event.key === "ArrowRight" ? -PAN_STEP : 0;
      const y = event.key === "ArrowUp" ? PAN_STEP : event.key === "ArrowDown" ? -PAN_STEP : 0;
      setView((current) => ({ ...current, x: current.x + x, y: current.y + y }));
    } else return;
    event.preventDefault();
  };
  return {
    surfaceRef,
    view,
    fit,
    zoom,
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
      onKeyDown,
      onDoubleClick: (event: MouseEvent<HTMLDivElement>) => {
        if (!(event.target as Element).closest(".rf-job-graph-node")) fit();
      },
    },
  };
}
