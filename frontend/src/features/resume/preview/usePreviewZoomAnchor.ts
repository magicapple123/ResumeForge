// SPDX-License-Identifier: Apache-2.0
/**
 * QW-7 的缩放锚点接线：把「缩放前记录光标下的内容点，渲染后滚回来」从
 * `ResumePreview` 里拆出来（行预算，也避免组件同时管测量、工具栏与滚动补偿）。
 *
 * 几何计算在 `./zoomAnchor.ts`（纯函数、单测覆盖）；这里只做三件事：
 * 1. 事件发生时读当前比例与光标/纸面矩形，存下内容点；
 * 2. 缩放提交后（layout effect，绘制前）按新纸面矩形算滚动补偿；
 * 3. 只补偿**真的能滚**的方向——内容比视口短时 `clampScroll` 返回 0，不制造负滚动。
 *
 * ## I-40：吃什么量什么
 *
 * 原来这里写死 `viewport.querySelector(".resume-preview-scale-box")`——那是**草稿**画布的
 * 元素，精确模式（`ExactPreviewPages` 的整页图片栈）没有它，于是每次缩放都空转。
 * 现在四个量全部由宿主给：
 *
 * | 量 | 草稿 | 精确 |
 * |---|---|---|
 * | `contentEl` | `.resume-preview-scale-box` | `.exact-preview-paper-column` |
 * | `hScroller` | `.resume-preview-viewport` | `.exact-preview`（仅 `.is-zoomed` 可横向滚） |
 * | `vScroller` | `.resume-preview-body` | `.resume-preview-body` |
 * | `scale` | `geometry.scale` | `rect.width / A4_WIDTH_PX`（**每次现量**） |
 *
 * 比例用 getter 而不是入参：精确模式的纸面宽度是 `floor(layoutWidth * zoom)`，传进来的
 * 数字会和实际渲染差 1px，多页时越算越偏。
 */
import { useCallback, useLayoutEffect, useRef } from "react";
import { clampPointerToBox, clampScroll, contentPoint, scrollDeltaFor } from "./zoomAnchor";

export interface ZoomAnchorTargets {
  /** 纸面内容框（尺寸随缩放变化的那一层）。 */
  contentEl: () => HTMLElement | null;
  /** 横向滚动容器。 */
  hScroller: () => HTMLElement | null;
  /** 纵向滚动容器。 */
  vScroller: () => HTMLElement | null;
  /** DOM px / 纸面 px；精确模式必须现量（见文件头）。 */
  scale: () => number;
}

interface Args extends ZoomAnchorTargets {
  /**
   * 渲染期比例，**只当 effect 依赖**：缩放状态提交后跑一次补偿。
   * 计算一律用 `scale()`（现量），两者在草稿模式是同一个值。
   */
  scaleValue: number;
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
export function usePreviewZoomAnchor(targets: Args) {
  const targetsRef = useRef<ZoomAnchorTargets>(targets);
  const pendingRef = useRef<PendingAnchor | null>(null);

  // 命令式回调要读"此刻"的目标与比例：layout effect 在绘制前同步，滚轮事件不可能早于它。
  useLayoutEffect(() => {
    targetsRef.current = targets;
  });

  const capture = useCallback((event: globalThis.WheelEvent | null) => {
    const current = targetsRef.current;
    const content = current.contentEl();
    if (!content) return;
    const currentScale = current.scale();
    if (!(currentScale > 0)) return;
    const rect = content.getBoundingClientRect();
    let pointer = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
    if (event) {
      // 纸面是 iframe（草稿），滚轮事件多半发生在 iframe 自己的文档里：那里的 clientX/Y 是
      // 未缩放的纸面坐标（0—794），要按当前 scale 换算到父页面坐标，否则锚点会偏。
      // 精确模式没有 iframe，`frameElement` 为 null，坐标天然是父页面坐标。
      const frame = (event.view as Window | null)?.frameElement as HTMLElement | null;
      if (frame) {
        const frameRect = frame.getBoundingClientRect();
        pointer = {
          x: frameRect.left + pointer.x * currentScale,
          y: frameRect.top + pointer.y * currentScale,
        };
      }
    } else {
      // 按钮缩放没有光标：用横向滚动容器（= 草稿视口）的中心；纸面比视口小时夹进纸面矩形。
      const host = current.hScroller() ?? content;
      const hostRect = host.getBoundingClientRect();
      pointer = {
        x: hostRect.left + hostRect.width / 2,
        y: hostRect.top + hostRect.height / 2,
      };
    }
    pointer = clampPointerToBox(pointer, rect);
    pendingRef.current = {
      content: contentPoint(pointer, { x: rect.left, y: rect.top }, currentScale),
      pointer,
      scale: currentScale,
    };
  }, []);

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const current = targetsRef.current;
    const content = current.contentEl();
    if (!content) return;
    const nextScale = current.scale();
    // 到边界时比例没变：这次不是缩放，不能拿一个陈旧的锚点去改滚动位置。
    if (Math.abs(nextScale - pending.scale) < 1e-9) return;
    const rect = content.getBoundingClientRect();
    const delta = scrollDeltaFor(
      pending.content,
      nextScale,
      { x: rect.left, y: rect.top },
      pending.pointer,
    );
    const horizontal = current.hScroller();
    if (horizontal) {
      const nextLeft = clampScroll(
        horizontal.scrollLeft + delta.x,
        horizontal.clientWidth,
        horizontal.scrollWidth,
      );
      if (nextLeft !== horizontal.scrollLeft) horizontal.scrollLeft = nextLeft;
    }
    const vertical = current.vScroller();
    if (vertical) {
      const nextTop = clampScroll(
        vertical.scrollTop + delta.y,
        vertical.clientHeight,
        vertical.scrollHeight,
      );
      if (nextTop !== vertical.scrollTop) vertical.scrollTop = nextTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在缩放提交时补偿一次
  }, [targets.scaleValue]);

  return capture;
}
