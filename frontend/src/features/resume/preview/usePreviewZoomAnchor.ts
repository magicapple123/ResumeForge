// SPDX-License-Identifier: Apache-2.0
/**
 * QW-7 的缩放锚点接线：把「缩放前记录光标下的内容点，渲染后滚回来」从
 * `ResumePreview` 里拆出来（行预算，也避免组件同时管测量、工具栏与滚动补偿）。
 *
 * 几何计算在 `./zoomAnchor.ts`（纯函数、单测覆盖）；这里只做三件事：
 * 1. 事件发生时读当前比例与光标/纸面矩形，存下内容点；
 * 2. 缩放提交后（layout effect，绘制前）按新纸面矩形算滚动补偿；
 * 3. 只补偿**真的能滚**的方向——内容比视口短时 `clampScroll` 返回 0，不制造负滚动。
 */
import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { clampPointerToBox, clampScroll, contentPoint, scrollDeltaFor } from "./zoomAnchor";

interface Args {
  /** 当前实际缩放（`fitScale × zoom`），每次渲染同步给命令式回调。 */
  scale: number;
  /** 横向滚动容器（`.resume-preview-viewport`）。 */
  viewportRef: RefObject<HTMLElement | null>;
  /** 纵向滚动容器（`.resume-preview-body`）：制作台里纵向由它接。 */
  bodyRef: RefObject<HTMLElement | null>;
}

interface PendingAnchor {
  content: { x: number; y: number };
  pointer: { x: number; y: number };
  scale: number;
}

/**
 * 返回 `capture(event)`：在调用 `zoomByWheel` / `zoomByFactor` **之后**调用
 * （此时状态已排队、DOM 还是旧尺寸，刚好能记下"缩放前"的内容点）。
 * 按钮缩放没有事件时传 `null`，锚点取视口中心。
 */
export function usePreviewZoomAnchor({ scale, viewportRef, bodyRef }: Args) {
  const scaleRef = useRef(scale);
  const pendingRef = useRef<PendingAnchor | null>(null);

  // 命令式回调要读"此刻"的比例：layout effect 在绘制前同步，滚轮事件不可能早于它。
  useLayoutEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const capture = useCallback(
    (event: globalThis.WheelEvent | null) => {
      const viewport = viewportRef.current;
      const box = viewport?.querySelector<HTMLElement>(".resume-preview-scale-box");
      if (!viewport || !box) return;
      const currentScale = scaleRef.current;
      const rect = box.getBoundingClientRect();
      let pointer = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
      if (event) {
        // 纸面是 iframe，滚轮事件多半发生在 iframe 自己的文档里：那里的 clientX/Y 是
        // 未缩放的纸面坐标（0—794），要按当前 scale 换算到父页面坐标，否则锚点会偏。
        const frame = (event.view as Window | null)?.frameElement as HTMLElement | null;
        if (frame) {
          const frameRect = frame.getBoundingClientRect();
          pointer = {
            x: frameRect.left + pointer.x * currentScale,
            y: frameRect.top + pointer.y * currentScale,
          };
        }
      } else {
        // 按钮缩放没有光标：用视口中心（纸面比视口小时，下面会夹进纸面矩形）。
        const viewportRect = viewport.getBoundingClientRect();
        pointer = {
          x: viewportRect.left + viewportRect.width / 2,
          y: viewportRect.top + viewportRect.height / 2,
        };
      }
      pointer = clampPointerToBox(pointer, rect);
      pendingRef.current = {
        content: contentPoint(pointer, { x: rect.left, y: rect.top }, currentScale),
        pointer,
        scale: currentScale,
      };
    },
    [viewportRef],
  );

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const viewport = viewportRef.current;
    const box = viewport?.querySelector<HTMLElement>(".resume-preview-scale-box");
    if (!viewport || !box) return;
    // 到边界时比例没变：这次不是缩放，不能拿一个陈旧的锚点去改滚动位置。
    if (Math.abs(scale - pending.scale) < 1e-9) return;
    const rect = box.getBoundingClientRect();
    const delta = scrollDeltaFor(
      pending.content,
      scale,
      { x: rect.left, y: rect.top },
      pending.pointer,
    );
    const nextLeft = clampScroll(
      viewport.scrollLeft + delta.x,
      viewport.clientWidth,
      viewport.scrollWidth,
    );
    if (nextLeft !== viewport.scrollLeft) viewport.scrollLeft = nextLeft;
    const body = bodyRef.current;
    if (body) {
      const nextTop = clampScroll(body.scrollTop + delta.y, body.clientHeight, body.scrollHeight);
      if (nextTop !== body.scrollTop) body.scrollTop = nextTop;
    }
  }, [bodyRef, scale, viewportRef]);

  return capture;
}
