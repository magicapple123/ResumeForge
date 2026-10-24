// SPDX-License-Identifier: Apache-2.0
/**
 * 把专业视图的**只读覆盖层**同步到纸面 iframe（D05 辅助线 / D10 灰度 / D09 裁剪预览），
 * 以及"当前页"高亮（D04）。
 *
 * 从组件里拆出来是为了两件事：
 * - `ProviewLayer` 只留状态与编排（300 行目标）；
 * - 两个 effect 都能在测试里用同一个 Provider + ResumePreview 的 iframe 直接验证。
 *
 * 覆盖层只写 iframe 的**临时文档**：纸面 HTML（`srcDoc`）不被修改，导出走服务端产物，
 * 因此辅助标记没有进入产物的通道。
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import type { PhotoCropParams } from "./photoCrop";
import { clearProviewOverlays, syncProviewOverlays } from "./previewOverlays";
import type { GuideFlags } from "./types";

/** 当前页高亮的类与样式（父页面 DOM；不进 iframe，也不进导出）。 */
export const CURRENT_PAGE_CLASS = "is-proview-current";
export const CURRENT_PAGE_STYLE_ID = "resume-proview-current-page-style";
// 用 token 而不是色值：当前页高亮画在**父页面**（应用主题里），深色主题必须跟着变。
const CURRENT_PAGE_CSS = `.resume-preview-page.${CURRENT_PAGE_CLASS}{outline:2px solid var(--rf-accent-violet);outline-offset:2px}`;

export interface OverlaySyncOptions {
  viewportRef: RefObject<HTMLElement | null>;
  guides: GuideFlags;
  proof: boolean;
  crop: PhotoCropParams | null;
  pageWidth: number;
  pageHeight: number;
  /** iframe 每次 load / 重排后自增，触发重刷。 */
  frameEpoch: number;
}

/** 辅助线 / 灰度 / 裁剪预览的注入同步。 */
export function useProviewOverlaySync({
  viewportRef,
  guides,
  proof,
  crop,
  pageWidth,
  pageHeight,
  frameEpoch,
}: OverlaySyncOptions): void {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const frames = Array.from(viewport.querySelectorAll("iframe"));
    const state = { guides, proof, crop, pageWidth, pageHeight };
    frames.forEach((frame) => syncProviewOverlays(frame.contentDocument, state));
    return () => {
      frames.forEach((frame) => clearProviewOverlays(frame.contentDocument));
    };
  }, [crop, frameEpoch, guides, pageHeight, pageWidth, proof, viewportRef]);
}

export interface CurrentPageHighlightOptions {
  viewportRef: RefObject<HTMLElement | null>;
  /** 1 起。 */
  currentPage: number;
  frameEpoch: number;
}

/**
 * 当前页高亮：给对应 `.resume-preview-page` 加一个类，并就地注入一条样式。
 *
 * 用"类 + 注入样式"而不是内联 style：页面节点的 style 由 `ResumePreviewCanvas` 渲染，
 * React 重渲染会覆盖手工写进去的内联值；类的增删与它的渲染无关，幂等且可清理。
 */
export function useCurrentPageHighlight({
  viewportRef,
  currentPage,
  frameEpoch,
}: CurrentPageHighlightOptions): void {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const doc = viewport.ownerDocument;
    let style = doc.getElementById(CURRENT_PAGE_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = CURRENT_PAGE_STYLE_ID;
      style.textContent = CURRENT_PAGE_CSS;
      doc.head.appendChild(style);
    }
    const pages = Array.from(viewport.querySelectorAll<HTMLElement>(".resume-preview-page"));
    pages.forEach((page, index) => {
      page.classList.toggle(CURRENT_PAGE_CLASS, index === currentPage - 1);
    });
    return () => {
      pages.forEach((page) => page.classList.remove(CURRENT_PAGE_CLASS));
      style?.remove();
    };
  }, [currentPage, frameEpoch, viewportRef]);
}
