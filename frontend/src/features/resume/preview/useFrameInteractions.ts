// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的交互：**只有"看"**——Ctrl+滚轮缩放、滚轮纵向转交外层、按住拖动平移。
 *
 * 这里曾经还有一套"编辑"模式（点纸面上的字段直接改），2026-10-21 按用户要求去掉：
 * 修改入口已经统一到「选中文字 → 右键 → AI 润色」与「手动调整」两条，预览里再放一套
 * 点击命中区，等于同一件事有两个入口、两套命中规则。
 *
 * 2026-10-21 多页改成竖向堆叠后，画布上同时有 N 个 iframe（一页一个），所以缩放轮的
 * 绑定从"一个固定 ref"改成 `bindFrame(frame)`：每个 iframe 各自绑、各自清。不绑的那几页
 * 会把 Ctrl+滚轮吃掉（iframe 是独立文档，事件不冒泡到父文档）。
 */
import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { PanStart } from "./config";

interface Options {
  containerRef: RefObject<HTMLDivElement | null>;
  panStartRef: MutableRefObject<PanStart | null>;
  onZoomWheel: (event: globalThis.WheelEvent) => void;
  onPanningChange: (value: boolean) => void;
  /**
   * 视口元素"换代"的信号：草稿画布在切换预览口径时会被卸载再挂载，
   * `containerRef.current` 就换成了一个**全新的 div**，而绑定在旧 div 上的
   * wheel / pointer 监听器随旧元素一起消失。effect 的依赖全是稳定引用（ref、setState），
   * 不重跑 → 新视口上没有任何监听器。
   *
   * 症状很能说明问题：**首次进草稿缩放正常，切到「精确」再切回来就失效**
   * （2026-10-21 用户实测）。把画布的身份传进来，换代时重绑即可。
   */
  viewportKey?: unknown;
  /**
   * 额外的滚轮监听节点（纸面滚动区 `.resume-preview-body`）。
   *
   * 精确模式的 PDF iframe **不在** `containerRef`（草稿视口）里，而是它的兄弟——只绑视口的话
   * 滚轮落进 PDF 就没人接，Ctrl+滚轮会变成**浏览器整页缩放**（2026-10-29 用户反馈"整个页面
   * 的缩放也跟着动了"）。绑在这一层，两种口径都走同一套缩放。已处理过的事件靠
   * `defaultPrevented` 判重，不会缩两格。
   */
  wheelRootRef?: RefObject<HTMLElement | null>;
}

/** 找到弹窗或页面真正负责纵向滚动的容器。 */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const canScroll =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight;
    if (canScroll) return current;
    current = current.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

/** iframe 是独立文档，普通滚轮不会冒泡到外层；把纵向滚动转交给外层页面。 */
export function forwardWheelToParent(container: HTMLElement | null, event: WheelEvent): boolean {
  const parent = scrollParent(container);
  let consumed = false;
  if (event.deltaY && parent) {
    const previous = parent.scrollTop;
    parent.scrollTop += event.deltaY;
    consumed ||= parent.scrollTop !== previous;
  }
  if (event.deltaX && container) {
    const previous = container.scrollLeft;
    container.scrollLeft += event.deltaX;
    consumed ||= container.scrollLeft !== previous;
  }
  return consumed;
}

export function useFrameInteractions({
  containerRef,
  panStartRef,
  onZoomWheel,
  onPanningChange,
  viewportKey,
  wheelRootRef,
}: Options) {
  /**
   * 每个 iframe 一份清理函数：同一个 iframe 刷新（换简历 / 切页数）时会再绑一次，
   * 先清旧的再绑，避免同一个文档上挂两个监听器（缩放一次跳两格）。
   */
  const cleanupsRef = useRef(new Map<HTMLIFrameElement, () => void>());

  const clearFrames = useCallback(() => {
    for (const cleanup of cleanupsRef.current.values()) cleanup();
    cleanupsRef.current.clear();
  }, []);

  const bindFrame = useCallback(
    (frame: HTMLIFrameElement) => {
      cleanupsRef.current.get(frame)?.();
      const document = frame.contentDocument;
      if (!document) return;
      document.addEventListener("wheel", onZoomWheel, { passive: false });
      cleanupsRef.current.set(frame, () => {
        document.removeEventListener("wheel", onZoomWheel);
      });
    },
    [onZoomWheel],
  );

  useEffect(() => clearFrames, [clearFrames]);

  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      panStartRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      viewport.setPointerCapture?.(event.pointerId);
      onPanningChange(true);
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const start = panStartRef.current;
      if (!start) return;
      event.preventDefault();
      // 多页竖排后主要靠纵向看：`scrollTop` 的位移就是"往上拖 = 往下看"。
      viewport.scrollLeft = start.scrollLeft - (event.clientX - start.clientX);
      viewport.scrollTop = start.scrollTop - (event.clientY - start.clientY);
    };
    const stopPanning = (event: globalThis.PointerEvent) => {
      if (viewport.hasPointerCapture?.(event.pointerId))
        viewport.releasePointerCapture?.(event.pointerId);
      panStartRef.current = null;
      onPanningChange(false);
    };

    viewport.addEventListener("wheel", onZoomWheel, { passive: false });
    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", stopPanning);
    viewport.addEventListener("pointercancel", stopPanning);
    viewport.addEventListener("lostpointercapture", stopPanning);
    return () => {
      viewport.removeEventListener("wheel", onZoomWheel);
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerup", stopPanning);
      viewport.removeEventListener("pointercancel", stopPanning);
      viewport.removeEventListener("lostpointercapture", stopPanning);
    };
  }, [containerRef, onPanningChange, onZoomWheel, panStartRef, viewportKey]);

  useEffect(() => {
    const node = wheelRootRef?.current;
    if (!node) return;
    node.addEventListener("wheel", onZoomWheel, { passive: false });
    return () => node.removeEventListener("wheel", onZoomWheel);
  }, [onZoomWheel, wheelRootRef, viewportKey]);

  return { bindFrame, clearFrames };
}
