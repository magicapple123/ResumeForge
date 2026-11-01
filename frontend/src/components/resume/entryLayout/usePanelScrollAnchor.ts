// SPDX-License-Identifier: Apache-2.0
/**
 * 面板滚动锚定（审计 R-10）。
 *
 * 场景：左栏「条目字段排版」里的灰字段列表在改动后会重排 / 增删一行，容器高度随
 * 之变化，浏览器（或 antd 的 auto-scroll）会把滚动位置调到一个"看起来没跳"的值，
 * 但用户看到的是整块内容上下位移——尤其在 360px 窄栏里，一行的位移就足以让刚点的
 * 控件跑出视野。
 *
 * 做法（与验收判据「切「前/后」行不移动、`scrollTop` 不变」一一对应）：
 * 1. 挂钩子返回的 ref 上的**最近可滚动祖先**（左栏页签面板 `.resume-wb-structure-tab`
 *    带 `overflow-y: auto`；宿主也可以用 `[data-panel-scroll]` 显式标记）；
 * 2. 监听它的 `scroll`，把当前位置存在 ref 里 —— 这就是"变化前"的快照；
 * 3. **只在 `dep` 变化时**用 `useLayoutEffect` 把快照写回去一次（绘制前，不闪）。
 *    不用 `useEffect`：那会在浏览器已经画完错位的一帧之后才纠正。
 *
 * 注意：只在 `dep` 引用变化时恢复一次，用户自己滚动不会被拽回去（滚动会刷新快照）。
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;

/** 宿主可以显式声明的滚动容器标记（结构页签面板上已加）。 */
const SCROLL_MARKER = "[data-panel-scroll]";

function isScrollable(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return SCROLLABLE_OVERFLOW.test(overflowY);
}

/** 从面板节点往上找"真正会滚"的那一层；找不到返回 null（面板不滚动时无需锚定）。 */
function findScrollContainer(start: HTMLElement | null): HTMLElement | null {
  if (!start) return null;
  const marked = start.closest<HTMLElement>(SCROLL_MARKER);
  if (marked && isScrollable(marked)) return marked;
  let current: HTMLElement | null = start.parentElement;
  while (current) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * @param dep 只在它变化时恢复一次滚动位置（面板传 `document` 引用）。
 * @returns 挂在面板根节点上的 ref。
 */
export function usePanelScrollAnchor<T extends HTMLElement>(dep: unknown): RefObject<T | null> {
  const anchorRef = useRef<T | null>(null);
  const scrollTopRef = useRef(0);

  useEffect(() => {
    const node = anchorRef.current;
    if (!node) return;
    const container = findScrollContainer(node);
    if (!container) return;
    // 挂载时先记一次当前值：否则第一次恢复会把这个面板拉回顶部。
    scrollTopRef.current = container.scrollTop;
    const remember = () => {
      scrollTopRef.current = container.scrollTop;
    };
    container.addEventListener("scroll", remember, { passive: true });
    return () => container.removeEventListener("scroll", remember);
  }, []);

  useLayoutEffect(() => {
    // 容器在每次布局效应里就地解析：不把它存进 ref，避免"跨效应共享可变 DOM 引用"。
    const container = findScrollContainer(anchorRef.current);
    if (!container) return;
    if (container.scrollTop !== scrollTopRef.current) {
      container.scrollTop = scrollTopRef.current;
    }
  }, [dep]);

  return anchorRef;
}
