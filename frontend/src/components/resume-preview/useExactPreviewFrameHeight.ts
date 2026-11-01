// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**相框高度**：按实际 PDF 页数算，而不是按"最大篇幅"（`pageLimit`）算。
 *
 * ## 为什么需要它
 *
 * 宿主（`ResumePreview`）传给 `ExactPreviewPanel` 的 `height` 是按 **pageLimit** 推出来的
 * 视口高度（`Math.max(MIN_PREVIEW_HEIGHT, …)`）。上限选 2/3 页、内容其实只有 1 页时，
 * iframe 仍占满上限高度：浏览器 PDF 查看器把那一页画在顶部，剩下的全是它自己的底色；
 * 而下方又按上限补齐了空白纸——于是"中间空一大截灰，然后才出现空白页"（2026-11-06
 * 用户截图；补页本身已在 2026-10-24 按用户口径去掉）。
 *
 * 相框高度改成"页数 × 单页高 + 页间距"之后，纸与页脚之间不再有那道灰。
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
 *
 * ## 缩放的两次修正（2026-10-29 用户反馈）
 *
 * 1. 旧实现只把纸列宽度改成 `scale × 相框宽`，指望查看器按新宽度重排——**它不会**：
 *    Chromium 的内置查看器只在**加载时**按 `#zoom=page-width` 适配一次，iframe 变窄之后纸
 *    还是原来那么大，只是被相框裁掉。用户看到的正是"点放大缩小，动的只有纸两边那圈灰边"。
 * 2. 于是先改成整块图层 `transform: scale()`——比例对了，但放大的是**已经栅格化**的图层，
 *    100% 以上肉眼可见变糊（用户截图："分辨率明显降低"）。
 *
 * 现在的做法：缩放时**换 iframe 的布局尺寸并重挂查看器**（面板里 `key` 带宽度），查看器按新
 * 宽度重新适配一次 —— 任何比例都是原生矢量渲染。相框高度跟着 `max(1, scale)`：缩小停在 fit
 * 高度（和 Ctrl+滚轮一样，只让纸变小、相框不跳），放大才跟着长。
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "./config";

/**
 * PDF 里相邻两页之间的间距（px），计入相框高度。
 *
 * 纸是 PDF 查看器自己排的，它内部页与页之间会留一道缝；相框按"页数 × 单页高"算会短一截，
 * 最后一页的下沿因此被裁掉。8 是与查看器实测最接近的一档（刻意不用草稿的
 * `PAGE_STACK_GAP_PX` = 24：那是**草稿**多页堆叠的未缩放间距，精确预览不缩放，
 * 沿用 24 会让相框凭空长出两倍多的空白）。
 */
export const FRAME_PAGE_GAP_PX = 8;

/**
 * PDF 查看器**自己在 iframe 里占掉的高度**（顶部那条深色工具栏：页码 / 缩放 / 下载 / 打印）。
 *
 * 2026-10-31 实测（有头 Chromium，一页 A4 @794×1123）：工具栏压掉页面可视高度约 52px，
 * 相框按"页数 × 页高"给高时右侧出现滚动条、末页下沿被裁；补 56px 后整页完整。
 * 取 56 而不是 52 是往"多一点"的一侧取：多出来的几像素只是页下留白，少给则会裁纸。
 *
 * 它**不随缩放变化**（工具栏是查看器自己的 UI），所以只在 `exactPreviewFrameHeight`
 * 里加一次，缩放只乘页面高度。
 */
export const VIEWER_CHROME_PX = 56;

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
 * - 其余 → `pages × 单页高 + (pages - 1) × 页间距 + VIEWER_CHROME_PX`。
 *
 * ## 查看器工具栏：已实测，按 56px 补偿
 *
 * Chromium 内置 PDF 查看器把工具栏画在 iframe **内部**（占的是 iframe 的可视高度，不是
 * 浮在纸面上）：只按 `pages × 页高` 给相框高度，纸会比相框高 50 多像素，右侧出竖条、
 * 末页下沿被裁。`VIEWER_CHROME_PX` 就是这 56px；补偿**只在这里**加一次，
 * 别在组件里加偏移——否则"相框高度只有这一处来源"这条就不成立了。
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
  return (
    pages * exactPreviewPageHeight(widthPx) + (pages - 1) * FRAME_PAGE_GAP_PX + VIEWER_CHROME_PX
  );
}

/** 只算"纸面内容"的高度（不含查看器工具栏）：缩放要乘的是这一段。 */
export function exactPreviewPagesHeight(widthPx: number, pages: number): number {
  if (pages <= 0 || widthPx <= 0) return 0;
  return pages * exactPreviewPageHeight(widthPx) + (pages - 1) * FRAME_PAGE_GAP_PX;
}

export interface ExactPreviewFrame {
  /** 挂到相框元素上（`.exact-preview`）：它的宽度就是 PDF 页的宽度。 */
  frameRef: RefObject<HTMLDivElement | null>;
  /** 相框该有的高度，见 `exactPreviewFrameHeight()`（已按 `scale` 折算）。 */
  frameHeight: number;
  /** 相框的**实测宽度**（0 = 还没量到）。缩放要用它算"纸本来多宽"，不能只看百分比。 */
  frameWidth: number;
}

/**
 * 量出相框宽度并算出它的高度。
 *
 * @param pages 已排出的实际页数（`0` = 还没有结果）。
 * @param fallbackHeight 量不到宽度 / 还没有结果时的占位高度。
 * @param scale 纸宽相对相框宽度的比例（精确预览的缩放：1 = 适应宽度）。
 *   纸宽 = 相框宽 × scale，页高必须跟着这条式子走——查看器按 `page-width` 排版，
 *   它看到的宽度就是 iframe 的宽度，而不是外层容器的宽度。
 */
export function useExactPreviewFrameHeight(
  pages: number,
  fallbackHeight: number,
  scale = 1,
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

  // 缩放只改变"纸有多大"，相框宽度本身不变（水平滚动条不影响 clientWidth），
  // 所以这里不会出现"变宽 → 出滚动条 → 变窄"的自激。
  return {
    frameRef,
    // 量到宽度之后：相框高度 = **未缩放高度 × max(1, scale)**（见文件头那节）。缩小不改相框
    // 高度，放大才跟着长；用"宽度 × scale 再算一遍"还会把页间距按原尺寸算进去，缩小后多灰。
    // 量不到宽度时按旧口径算，单页时两者数值相同。
    //
    // R-27：这里原来漏了 `max(1, …)` —— 注释写的是"缩小不改相框高度"，代码却乘了 scale，
    // 于是缩到 80% 时相框比纸短一截、末页下沿被裁（用户看到的是"缩小后反而看不全"）。
    frameHeight:
      frameWidth > 0
        ? Math.round(
            exactPreviewPagesHeight(frameWidth, pages) * Math.max(1, scale) + VIEWER_CHROME_PX,
          )
        : exactPreviewFrameHeight(frameWidth * scale, pages, fallbackHeight),
    frameWidth,
  };
}
