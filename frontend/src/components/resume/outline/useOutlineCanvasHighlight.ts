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
  /**
   * 显式"定位"请求（D01）：只在用户按 Enter/点定位时把纸面对应元素滚进可视区；
   * 普通选中变化只换高亮、不滚动画布（否则每点一行纸面就跳一下）。
   */
  reveal?: { path: string; nonce: number } | null;
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

/**
 * 把纸面上某个 `data-resume-path` 滚进可视区（D01 显式定位用）。
 *
 * 精确路径优先，匹配不到时退到"前缀"（条目级定位：整条内容都在可视区附近）。返回是否
 * 找到了元素——找不到不是错误（预览还没渲染这一版），调用方不弹失败提示。
 */
export function revealPathInDocument(doc: Document | null | undefined, path: string): boolean {
  if (!doc || !path) return false;
  const safe = path.replace(/"/g, "");
  const node =
    doc.querySelector<HTMLElement>(`[data-resume-path="${safe}"]`) ??
    doc.querySelector<HTMLElement>(`[data-resume-path^="${safe}."]`);
  if (!node || typeof node.scrollIntoView !== "function") return false;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

/** 把定位请求应用到容器内所有 iframe（返回是否至少一帧命中）。 */
export function revealPathInHost(host: HTMLElement | null | undefined, path: string): boolean {
  if (!host) return false;
  let revealed = false;
  for (const frame of framesOf(host)) {
    if (revealPathInDocument(frame.contentDocument, path)) revealed = true;
  }
  return revealed;
}

const RETRY_LIMIT = 60;

export function useOutlineCanvasHighlight({
  targets,
  container,
  containerRef,
  reveal,
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

  // 显式定位：只跟 nonce 走（同一路径再按一次 Enter 也要能重新滚回来）。
  const revealNonce = reveal?.nonce ?? 0;
  const revealPath = reveal?.path ?? "";
  useEffect(() => {
    if (!revealNonce || !revealPath) return;
    const host = container ?? containerRef?.current ?? null;
    revealPathInHost(host, revealPath);
  }, [container, containerRef, revealNonce, revealPath]);
}
