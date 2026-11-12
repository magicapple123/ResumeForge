// SPDX-License-Identifier: Apache-2.0
/**
 * 「这一栏有多宽」——面板自身的窄档判定（审计 R-11-8 / R-33 R2）。
 *
 * 为什么不是纯 CSS 容器查询：`@container` 只能改样式，而 antd 的 `Segmented` 想要
 * 真正的竖排必须用它的 `vertical` 属性（内部选中态与滑块是按 DOM 结构算的，
 * 用 CSS 强行 `flex-direction: column` 会让选中项失去高亮）。所以这里用
 * `ResizeObserver` 盯住**面板自己**的宽度，把结果交给 `vertical`。
 *
 * 阈值与 CSS 里的 `@container wb-params (max-width: 420px)` 保持一致：420 是
 * "一行里放下 4 字标签 + 控件 + 尾部读数"的下限（见 `workbench-narrow.css`）。
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export const NARROW_PANEL_WIDTH = 420;

export interface PanelNarrowState<T extends HTMLElement> {
  ref: RefObject<T | null>;
  /** 面板宽度 ≤ 420px。 */
  narrow: boolean;
}

export function usePanelNarrow<T extends HTMLElement>(
  threshold: number = NARROW_PANEL_WIDTH,
): PanelNarrowState<T> {
  const ref = useRef<T | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // jsdom（单测）没有 ResizeObserver：保持默认的"宽档"，不抛错。
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => setNarrow(node.clientWidth > 0 && node.clientWidth <= threshold);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, narrow };
}
