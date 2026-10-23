// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**相框高度**：按实际 PDF 页数算，而不是按"最大篇幅"（`pageLimit`）算。
 *
 * ## 为什么需要它
 *
 * 宿主（`ResumePreview`）传给 `ExactPreviewPanel` 的 `height` 是按 **pageLimit** 推出来的
 * 视口高度（`Math.max(MIN_PREVIEW_HEIGHT, …)`）。上限选 2/3 页、内容其实只有 1 页时，
 * iframe 仍占满上限高度：浏览器 PDF 查看器把那一页画在顶部，剩下的全是它自己的底色；
 * 而我们补的空白纸又是相框**之后**的兄弟节点——于是"中间空一大截灰，然后才出现空白页"
 * （2026-11-06 用户截图）。
 *
 * 相框高度改成"页数 × 单页高 + 页间距"之后，空白纸紧接在最后一页之后，中间不再有灰。
 *
 * ## 单页高从哪来
 *
 * 不能写死 1123（A4 @96dpi）：中栏分隔条可以拖动，相框宽度随时在变，PDF 查看器按
 * **宽度**等比缩放，页高必须跟着宽度走。所以量一次自身宽度（`ResizeObserver`），
 * 再乘 A4 的高宽比（297 / 210）。
 *
 * 用 `ResizeObserver` 而不是 `window.resize`：拖分隔条时窗口尺寸一点没变，变的只是
 * 这一块的宽度。第一枪由观察器自己在 `observe()` 之后投递（异步），因此不存在
 * "effect 体里同步 setState"（项目有 `react-hooks/set-state-in-effect`）。
 *
 * ## 宽度量不到时**必须**退回宿主给的 `height`
 *
 * 三种情况会量到 0：首次布局之前、面板在 `hidden` 容器里（草稿模式）、以及 jsdom
 * （`src/test/setup.ts` 的 `ResizeObserverMock` 只占位、不投递回调）。
 * 这时**不能**按 0 宽去算（那会得到 0 高的相框），也不能自己编一个兜底宽度：
 * 宿主给的 `height` 才是"这一屏有多高"的唯一已知值，退回它，占位与真实结果都不跳。
 * 高度算式因此抽成纯函数 `exactPreviewFrameHeight()`，可以脱离 DOM 单测。
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "./config";

/**
 * 空白纸与最后一页 PDF 之间的间距（px）。
 *
 * 与 `.exact-preview-blanks` 的 `gap` 必须一致（CSS 里也写着 8）。刻意不用
 * `PAGE_STACK_GAP_PX`（24）：那是**草稿**多页堆叠的未缩放间距，而草稿预览整体带缩放，
 * 屏幕上真正看到的大约就是 8px 上下；精确预览不缩放，直接沿用 24 会显得两张纸离得很远。
 */
export const BLANK_PAGE_GAP_PX = 8;

/** A4 的高宽比（297 / 210）。用 `config.ts` 的常量相除，两处只有一个 794/1123 口径。 */
export const A4_RATIO = A4_HEIGHT_PX / A4_WIDTH_PX;

/**
 * 单页高度（px）：宽度 × A4 高宽比，取整（避免半像素让相邻两页的边线各自糊一层）。
 *
 * @param widthPx 相框实测宽度。
 */
export function exactPreviewPageHeight(widthPx: number): number {
  return Math.round(widthPx * A4_RATIO);
}

/**
 * 相框该有的高度（纯函数，可脱离 DOM 单测）。
 *
 * - `pages <= 0`（还没有任何结果，仍在等第一次排版）→ `fallbackHeight`；
 * - `widthPx <= 0`（量不到宽度：首次布局前 / 面板隐藏 / jsdom）→ `fallbackHeight`，
 *   **绝不算出 0 高**；
 * - 其余 → `pages × 单页高 + (pages - 1) × 页间距`。
 *
 * ## 已知未补偿项：查看器自带的悬浮工具栏（**改这里**）
 *
 * Chromium 内置 PDF 查看器会在 iframe **内部**叠一条悬浮工具栏（约 56px，含页码/缩放/
 * 下载），它盖住的是 iframe 的顶部——也就是说第一页顶部会被遮掉一截、末页可能要多滚一点。
 * 2026-11-06 明确**先不加这个常数**（是否真的压住最后一页要等真机截图确认）。
 * 若确认需要补偿，**唯一该改的位置就是这个函数的返回值**：给 `pages × 单页高` 再加一个
 * `VIEWER_CHROME_PX`（并同步 `.exact-preview-blanks` 的 `margin-top`，否则空白纸会贴着
 * 被遮住的那一截）。别在组件里加偏移——否则"相框高度只有这一处来源"这条就不成立了。
 *
 * @param widthPx 相框实测宽度；0 或负数表示"没量到"。
 * @param pages 已排出的实际页数（调用方已把 `null` 归一成 1）。
 * @param fallbackHeight 量不到宽度或还没有结果时用的高度（宿主按上限算的那个）。
 */
export function exactPreviewFrameHeight(
  widthPx: number,
  pages: number,
  fallbackHeight: number,
): number {
  if (pages <= 0 || widthPx <= 0) return fallbackHeight;
  return pages * exactPreviewPageHeight(widthPx) + (pages - 1) * BLANK_PAGE_GAP_PX;
}

export interface ExactPreviewFrame {
  /** 挂到相框元素上（`.exact-preview`）：它的宽度就是 PDF 页的宽度。 */
  frameRef: RefObject<HTMLDivElement | null>;
  /** 相框该有的高度，见 `exactPreviewFrameHeight()`。 */
  frameHeight: number;
}

/**
 * 量出相框宽度并算出它的高度。
 *
 * @param pages 已排出的实际页数（`0` = 还没有结果）。
 * @param fallbackHeight 量不到宽度 / 还没有结果时的占位高度。
 */
export function useExactPreviewFrameHeight(
  pages: number,
  fallbackHeight: number,
): ExactPreviewFrame {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setFrameWidth(width > 0 ? width : 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { frameRef, frameHeight: exactPreviewFrameHeight(frameWidth, pages, fallbackHeight) };
}
