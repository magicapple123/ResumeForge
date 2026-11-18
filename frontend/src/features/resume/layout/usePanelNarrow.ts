// SPDX-License-Identifier: Apache-2.0
/**
 * 「这一栏有多宽」——面板自身的窄档判定 + 参数行控件列的连续宽度（审计 R-11-8 / R-33 R2 / DF-7）。
 *
 * ## 为什么不是纯 CSS 容器查询
 *
 * `@container` 只能改样式，而 antd 的 `Segmented` 想要真正的竖排必须用它的 `vertical` 属性
 * （内部选中态与滑块是按 DOM 结构算的，用 CSS 强行 `flex-direction: column` 会让选中项
 * 失去高亮）。所以这里用 `ResizeObserver` 盯住**面板自己**的宽度，把结果交给 `vertical`。
 *
 * 阈值 340：一行里放下「2–4 字标签 + 控件 + 尾部读数」的下限。2026-11-18 从 420 降到 340
 * （DF-7）：420 时参数栏最常见的 380–440 宽度会过早把分段控件竖起来，而实际 340 以内才
 * 真的挤不下。只对 `Segmented` 这类离散控件生效，滑杆行另有连续宽度（见下）。
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export const NARROW_PANEL_WIDTH = 340;

/** 参数行标签列宽度（与 `resume-workbench-controls.css` 的 `--resume-wb-label-w` 同值）。 */
const LABEL_WIDTH = 72;
/** 尾部下限：读数 44 + 行内 6px 间距 + 来源胶囊 52。小于它就会切胶囊。 */
const TAIL_MIN_WIDTH = 102;
/** 两列之间的间隙（标签→控件、控件→尾部）。 */
const COLUMN_GAP = 6;
/**
 * 控件列下限：± 各 30 + 两道 2px 间距 + 滑杆 64 = 128。
 *
 * 132（滑杆 68）是 2026-11 的旧下限，按「参数栏内容宽 325」算的；实测分组卡片还有
 * 1px 边框 + 12px 内边距（合计 26），最窄的 380 栏里只够 128。滑杆 64 仍可拖
 * （`resume-workbench-controls.css` 的滑杆段解释了 56 是绝对下限）。
 */
export const CONTROLS_MIN_WIDTH = 128;

/**
 * 由**分组内容盒**（`.resume-wb-group-body`，与容器查询的容器同一个元素）的宽度算出
 * 控件列宽度：`内容宽 − 标签 − 两道间隙 − 尾部下限`，再夹到下限。
 *
 * 量测点必须与容器查询一致：容器查询改的是分组内容盒里的行，量整列会把卡片边框与
 * 内边距一起算进去（26px），控件列就会把尾部顶出卡片。
 */
export function controlsWidthFor(bodyWidth: number): number {
  if (!Number.isFinite(bodyWidth) || bodyWidth <= 0) return CONTROLS_MIN_WIDTH;
  const available = Math.floor(bodyWidth) - LABEL_WIDTH - TAIL_MIN_WIDTH - COLUMN_GAP * 2;
  return Math.max(CONTROLS_MIN_WIDTH, available);
}

export interface PanelNarrowState<T extends HTMLElement> {
  ref: RefObject<T | null>;
  /** 面板宽度 ≤ 340px。 */
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

/**
 * 参数行控件列的**连续**宽度（DF-7）：盯住列里每个分组的 `.resume-wb-group-body`，
 * 把算出的像素值写到**列根元素**的 `--resume-wb-controls-w`。
 *
 * 为什么是一个共享变量而不是每行各自量：每行都是**独立**的 grid，各自按内容算宽度时
 * 「有来源胶囊」的行与「没有」的行控件列会差 58px，滑杆右缘与读数左缘立刻错开
 * （2026-11-06 修过三轮的老问题）。所有行继承同一个值，列宽天然一致。
 *
 * 三条实现约束（改动前先读）：
 * 1. **变量只写到列根**，不写 `:root`——同一屏可能挂两份左栏（整屏弹窗 + 窄屏抽屉），
 *    写 `:root` 会让两个实例互相覆盖。
 * 2. **不防抖**：拖动分隔条时每帧都要跟着变；防抖会退回"松手才跳一下"，正是本项要修的。
 *    回调里只做「读 clientWidth → 算 → 一次 setProperty」，写完不再读布局。
 * 3. 分组可以收起（body 被卸载）：`MutationObserver` 只负责把新 body 补进观察列表，
 *    不在回调里做量测以外的事。
 */
export function useControlsWidthVar<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const root = ref.current;
    // jsdom（单测）没有 ResizeObserver：CSS 里保留了 152px 的兜底值。
    if (!root || typeof ResizeObserver === "undefined") return;
    let last = -1;
    const measure = () => {
      const body = root.querySelector<HTMLElement>(".resume-wb-group-body");
      const bodyWidth = body ? body.clientWidth : 0;
      if (bodyWidth <= 0) return;
      const next = controlsWidthFor(bodyWidth);
      if (next === last) return;
      last = next;
      root.style.setProperty("--resume-wb-controls-w", `${next}px`);
    };
    const observer = new ResizeObserver(measure);
    const observed = new Set<Element>();
    const rescan = () => {
      root.querySelectorAll(".resume-wb-group-body").forEach((body) => {
        if (observed.has(body)) return;
        observed.add(body);
        observer.observe(body);
      });
      measure();
    };
    rescan();
    observer.observe(root);
    const mutation = new MutationObserver(rescan);
    mutation.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutation.disconnect();
      observed.clear();
    };
  }, [ref]);
}
