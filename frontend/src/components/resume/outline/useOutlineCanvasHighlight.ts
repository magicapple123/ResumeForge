// SPDX-License-Identifier: Apache-2.0
/**
 * 把"大纲选中对象"画到右栏纸面上：向画布里的每个预览 iframe 注入一条高亮样式。
 *
 * 为什么不重渲染：纸面是后端模板输出的 HTML（`data-resume-path` 已在每处文字上），
 * 选中的变化只是"换一条选择器"，重排一遍既慢又会闪。注入的样式元素带固定 id，
 * 重复注入按 id 替换而不是叠加。
 *
 * ## 两个生命周期细节
 *
 * 1. **iframe 会重载**（实时预览每次重排换新 srcDoc）：只注入一次会在下一次输入后消失，
 *    所以在容器上挂捕获阶段的 `load` 监听 + `MutationObserver` 兜住新插入的 iframe。
 * 2. **容器可能晚到一帧**：制作台用 ref 回调 + state 持有画布节点，挂载当帧可能还是 null；
 *    用有界的 `requestAnimationFrame` 重试（约 60 帧）而不是无限轮询。
 */
import { useEffect, useMemo } from "react";
import type { RefObject } from "react";
import {
  buildOutlineHighlightCss,
  OUTLINE_HIGHLIGHT_STYLE_ID,
  type OutlineHighlightTarget,
} from "../../../features/resume-outline/highlight";

export interface OutlineCanvasHighlightOptions {
  targets: readonly OutlineHighlightTarget[];
  /** 画布容器节点（推荐：制作台用 ref 回调 + state 持有它）。 */
  container?: HTMLElement | null;
  /** 兼容传 ref 的宿主；容器晚于首次渲染就绪时会有界重试。 */
  containerRef?: RefObject<HTMLElement | null>;
}

/** 往一个 iframe 文档里写/更新高亮样式；`css` 为空时删除。 */
export function applyOutlineHighlightToDocument(
  doc: Document | null | undefined,
  css: string,
): void {
  if (!doc) return;
  const root = doc.head ?? doc.documentElement;
  if (!root) return;
  let style = doc.getElementById(OUTLINE_HIGHLIGHT_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement("style");
    style.id = OUTLINE_HIGHLIGHT_STYLE_ID;
    root.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function framesOf(host: HTMLElement): HTMLIFrameElement[] {
  return Array.from(host.querySelectorAll<HTMLIFrameElement>("iframe"));
}

/** 给容器内所有预览 iframe 应用高亮（`css` 为空 = 清除）。可在非 React 单测里直接调用。 */
export function paintOutlineHighlight(host: HTMLElement | null | undefined, css: string): void {
  if (!host) return;
  for (const frame of framesOf(host)) applyOutlineHighlightToDocument(frame.contentDocument, css);
}

/** 清除容器内所有预览 iframe 的高亮样式。 */
export function clearOutlineHighlight(host: HTMLElement | null | undefined): void {
  paintOutlineHighlight(host, "");
}

const RETRY_LIMIT = 60;

export function useOutlineCanvasHighlight({
  targets,
  container,
  containerRef,
}: OutlineCanvasHighlightOptions): void {
  const css = useMemo(() => buildOutlineHighlightCss(targets), [targets]);

  useEffect(() => {
    const resolve = (): HTMLElement | null => container ?? containerRef?.current ?? null;
    let raf = 0;
    let tries = 0;
    let teardown: (() => void) | null = null;

    const attach = (host: HTMLElement) => {
      const apply = () => paintOutlineHighlight(host, css);
      apply();
      // iframe 的 load 不冒泡：捕获阶段才能在容器上统一收到。
      host.addEventListener("load", apply, true);
      const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(apply) : null;
      observer?.observe(host, { childList: true, subtree: true });
      teardown = () => {
        host.removeEventListener("load", apply, true);
        observer?.disconnect();
      };
    };

    const start = () => {
      const host = resolve();
      if (host) {
        attach(host);
        return;
      }
      if (tries < RETRY_LIMIT && typeof requestAnimationFrame === "function") {
        tries += 1;
        raf = requestAnimationFrame(start);
      }
    };
    start();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      teardown?.();
      // 组件卸载后纸面不该继续亮着：显式清一次（含"选择被清空时 css='' 已自行删除"的情况）。
      clearOutlineHighlight(resolve());
    };
  }, [container, containerRef, css]);
}
