// SPDX-License-Identifier: Apache-2.0
/**
 * 页导航状态（D04）：当前页 / 总页数 / 上一页 / 下一页 / 跳页。
 *
 * 实现要点：
 * - 滚动容器**不一定是预览组件自己**：制作台里是外层 `.resume-wb-canvas-scroll`，
 *   主预览里是 `.resume-preview-viewport`，所以每次按"页面 relative 到容器"重新找；
 * - 监听挂在找到的滚动容器上（每次 refreshKey 变化重挂）+ window resize；
 * - 全部 DOM 读取都发生在 effect / 回调里（不在渲染期读 ref，满足 react-hooks/refs）。
 */
import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import {
  clampPage,
  findScrollableAncestor,
  measureVisiblePage,
  scrollToPageElement,
  stepPage,
} from "./pageNavigation";

export interface PageNavigation {
  currentPage: number;
  totalPages: number;
  goToPage: (page: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  /** 滚动容器里没有第二条纵向滚动条时（单页 / 精确模式）为 false。 */
  scrollable: boolean;
}

export interface PageNavigationOptions {
  /** 预览视口（`.resume-preview-viewport`，页面 iframe 都住在里面）。 */
  viewportRef: RefObject<HTMLElement | null>;
  totalPages: number;
  /** iframe 重排/重载后加一：页面位置变了，当前页要重新算。 */
  refreshKey?: number;
  enabled?: boolean;
}

export function usePageNavigation({
  viewportRef,
  totalPages,
  refreshKey = 0,
  enabled = true,
}: PageNavigationOptions): PageNavigation {
  const total = Math.max(1, Math.round(totalPages));
  const [currentPage, setCurrentPage] = useState(1);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const scroller = findScrollableAncestor(viewport) ?? viewport;
    const sync = () => {
      const page = measureVisiblePage(viewport, scroller);
      setCurrentPage((previous) => (previous === page ? previous : page));
      const canScroll = scroller.scrollHeight > scroller.clientHeight + 1;
      setScrollable((previous) => (previous === canScroll ? previous : canScroll));
    };
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      scroller.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [enabled, refreshKey, viewportRef]);

  const goToPage = useCallback(
    (page: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const scroller = findScrollableAncestor(viewport) ?? viewport;
      const target = clampPage(page, total);
      scrollToPageElement(scroller, viewport, target);
      setCurrentPage(target);
    },
    [total, viewportRef],
  );

  const nextPage = useCallback(() => {
    setCurrentPage((previous) => {
      const target = stepPage(previous, total, 1);
      const viewport = viewportRef.current;
      if (viewport) {
        const scroller = findScrollableAncestor(viewport) ?? viewport;
        scrollToPageElement(scroller, viewport, target);
      }
      return target;
    });
  }, [total, viewportRef]);

  const previousPage = useCallback(() => {
    setCurrentPage((previous) => {
      const target = stepPage(previous, total, -1);
      const viewport = viewportRef.current;
      if (viewport) {
        const scroller = findScrollableAncestor(viewport) ?? viewport;
        scrollToPageElement(scroller, viewport, target);
      }
      return target;
    });
  }, [total, viewportRef]);

  const clampCurrent = clampPage(currentPage, total);
  return {
    currentPage: clampCurrent,
    totalPages: total,
    goToPage,
    nextPage,
    previousPage,
    scrollable,
  };
}
