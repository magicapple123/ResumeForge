// SPDX-License-Identifier: Apache-2.0
/**
 * 页导航的纯几何（D04）。
 *
 * 画布的多页是**竖向堆叠的独立滚动**：当前页 = 视口中线落在哪一页。判定放在纯函数里，
 * 是因为 jsdom 没有真实排版（所有 rect 都是 0），只有纯函数能在测试里覆盖"翻到第 2 页"
 * 而不用伪造整套布局引擎。
 */

/** 一页相对**滚动容器**的盒子（top 已减去容器顶）。 */
export interface PageBox {
  top: number;
  height: number;
}

/** 页码夹取到 [1, total]。 */
export function clampPage(page: number, total: number): number {
  const safeTotal = Math.max(1, Math.round(total));
  if (!Number.isFinite(page)) return 1;
  return Math.min(safeTotal, Math.max(1, Math.round(page)));
}

/** 上一页 / 下一页（已在两端时返回原位，不发滚动）。 */
export function stepPage(page: number, total: number, delta: number): number {
  return clampPage(clampPage(page, total) + delta, total);
}

/**
 * 视口中线命中的页码（1 起）。
 *
 * 判定顺序：视口中点落在某页内 → 该页；否则取与视口中心**距离最近**的一页。
 * 这样半页滚动时读数不会在两页之间抖动（距离相等时取靠上的那页，阅读顺序是从上到下）。
 */
export function resolveVisiblePage(pages: readonly PageBox[], viewportHeight: number): number {
  if (pages.length === 0) return 1;
  const center = (Number.isFinite(viewportHeight) ? viewportHeight : 0) / 2;
  let bestPage = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  pages.forEach((box, index) => {
    const top = box.top;
    const bottom = box.top + box.height;
    let distance = 0;
    if (center < top) distance = top - center;
    else if (center > bottom) distance = center - bottom;
    if (distance < bestDistance - 0.5) {
      bestDistance = distance;
      bestPage = index + 1;
    }
  });
  return bestPage;
}

/**
 * 滚动到某页顶部需要的 scrollTop。
 *
 * 用"页面相对容器的 top + 当前 scrollTop"而不是 `offsetTop`：页面在缩放层（transform）
 * 里面，offsetTop 不含缩放，而 rect 含——两者差一个 scale，翻到第 2 页就会偏。
 */
export function pageScrollTop(pageTopInScroller: number, currentScrollTop: number): number {
  return Math.max(0, currentScrollTop + pageTopInScroller);
}

/**
 * 从 `start` 往上找真正滚动的祖先。
 *
 * 制作台的滚动条不在预览组件里（`.resume-wb-canvas-scroll` 由外层提供），主预览里却在
 * `.resume-preview-viewport` 自己身上——不找祖先就只能服务其中一种宿主。
 */
export function findScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = start;
  while (node) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
      const overflowY = style?.overflowY ?? "";
      if (overflowY === "auto" || overflowY === "scroll" || node.dataset.proviewScroll === "1") {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

/** 读当前可见页：容器里每页的 rect 相对滚动容器换算成盒子。 */
export function measureVisiblePage(container: HTMLElement | null, scroller: HTMLElement): number {
  if (!container) return 1;
  const scrollerRect = scroller.getBoundingClientRect();
  const pages = Array.from(container.querySelectorAll<HTMLElement>(".resume-preview-page"));
  const boxes: PageBox[] = pages.map((page) => {
    const rect = page.getBoundingClientRect();
    return { top: rect.top - scrollerRect.top, height: rect.height };
  });
  return resolveVisiblePage(boxes, scrollerRect.height);
}

/** 滚动到第 `page` 页顶部（1 起）。找不到页面时保持不动。 */
export function scrollToPageElement(
  scroller: HTMLElement,
  container: HTMLElement | null,
  page: number,
): void {
  if (!container) return;
  const pages = Array.from(container.querySelectorAll<HTMLElement>(".resume-preview-page"));
  const target = pages[clampPage(page, pages.length) - 1];
  if (!target) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  scroller.scrollTop = pageScrollTop(targetRect.top - scrollerRect.top, scroller.scrollTop);
}
