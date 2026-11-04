// SPDX-License-Identifier: Apache-2.0
/**
 * 球旁浮卡的夹取应用层（问题 8-A 的 DOM 半边）。
 *
 * 分工：
 *   · `anchoredCard.ts` —— 纯函数，只做算术（可单测，不碰 DOM）；
 *   - 本 hook —— 量卡片宽度与球的位置，把算出来的**视口坐标**换算成"相对壳的 px"
 *     写进卡片的内联样式，顺带把尾巴与入场缩放原点一起写过去。
 *
 * 两条硬约定：
 * 1. **只写 `left`，绝不写 `transform`。** `.tt-card` 的入场 / 退场动画（`tt-card-in` /
 *    `tt-card-out`）本身就是 transform，夹取若用 `translateX` 会与动画互相覆盖。
 *    小贴士的居中位移则通过 `--tt-tip-shift-x` 变量退成 0，同样不动 transform 属性。
 * 2. **首帧量不到尺寸时不写内联样式**（jsdom、尚未布局时 `getBoundingClientRect` 全 0），
 *    沿用现有 CSS 定位，避免"先闪到错位置再跳回来"。`useLayoutEffect` 在浏览器绘制前
 *    就跑完，卡片还有 220ms 入场动画，这一帧的校正肉眼不可见。
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ANCHORED_CARD_MARGIN,
  clampAnchoredCard,
  clampTipLeft,
  type AnchoredTipSide,
} from "./anchoredCard";

/** 浮卡与球共用的外壳选择器（`position: fixed` 的 64px 方块，卡的包含块）。 */
const SHELL_SELECTOR = ".tt-shell";

export interface UseTouTouAnchoredCardOptions {
  /**
   * 卡片是否带指向球心的尾巴（`.tt-card` 有 → 顺带写 `--tt-tail-right`；
   * `.tt-tip` 没有 → 只算 `left`，并把水平居中位移退成 0）。
   */
  withTail?: boolean;
}

/** 一次测量得到的、可以直接落到内联样式上的三个数。 */
interface AnchoredMeasurement {
  /** 相对壳左缘的水平偏移（px），可以为负（卡片向左展开时壳左缘在卡的右边）。 */
  left: number;
  /** 尾巴的 `right` 偏移（相对卡片右缘）；小贴士没有尾巴，为 null。 */
  tailRight: number | null;
  /** `transform-origin` 的水平分量；小贴士不参与入场缩放，为 null。 */
  originX: string | null;
}

/** 从壳的贴边类名读出球当前贴哪一边（与吸附逻辑同源，`useTouTouCardDrag` 也这么读）。 */
function readTipSide(shell: HTMLElement): AnchoredTipSide {
  const classes = shell.className;
  if (classes.includes("is-edge-left")) return "left";
  if (classes.includes("is-edge-right")) return "right";
  if (classes.includes("is-edge-top")) return "top";
  if (classes.includes("is-edge-bottom")) return "bottom";
  // 没有贴边类（不该发生）时按"贴在球下方"处理：水平居中是最安全的落点。
  return "bottom";
}

/**
 * 把球旁卡片夹进视口，返回该写进 `style` 的内联样式。
 *
 * @param ref 卡片根元素（`.tt-card` 或 `.tt-tip`）。
 * @param options `withTail=false` 时按小贴士处理（只算 left）。
 * @returns 内联样式；首帧量不到尺寸时是空对象（沿用 CSS）。
 */
export function useTouTouAnchoredCard<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { withTail = true }: UseTouTouAnchoredCardOptions = {},
): CSSProperties {
  const [measurement, setMeasurement] = useState<AnchoredMeasurement | null>(null);

  /** 值没变就返回原对象：layout effect 每次渲染都跑，靠这个提前退出避免无限重渲染。 */
  const commit = useCallback((next: AnchoredMeasurement) => {
    setMeasurement((previous) =>
      previous &&
      previous.left === next.left &&
      previous.tailRight === next.tailRight &&
      previous.originX === next.originX
        ? previous
        : next,
    );
  }, []);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const shell = element.closest(SHELL_SELECTOR);
    if (!(shell instanceof HTMLElement)) return;

    const shellRect = shell.getBoundingClientRect();
    const cardRect = element.getBoundingClientRect();
    const cardWidth = cardRect.width;
    const orbSize = shellRect.width;
    // 首帧 / jsdom：尺寸量不到就什么都不写，让 CSS 的默认定位先顶着（见文件头约定 2）。
    if (!(cardWidth > 0) || !(orbSize > 0)) return;

    const viewportWidth = window.innerWidth;
    if (withTail) {
      const placement = clampAnchoredCard({
        cardWidth,
        margin: ANCHORED_CARD_MARGIN,
        orbLeft: shellRect.left,
        orbSize,
        viewportWidth,
      });
      commit({
        left: placement.left - shellRect.left,
        originX: placement.align === "right" ? "100%" : "0%",
        tailRight: placement.tailRight,
      });
      return;
    }

    const tipLeft = clampTipLeft({
      cardWidth,
      margin: ANCHORED_CARD_MARGIN,
      orbLeft: shellRect.left,
      orbSize,
      side: readTipSide(shell),
      viewportWidth,
    });
    commit({ left: tipLeft - shellRect.left, originX: null, tailRight: null });
  }, [commit, ref, withTail]);

  // 刻意不给依赖数组：卡片是按需挂载的（`control` 为 null 时整块返回 null），首次渲染时
  // ref 还是空的。每次渲染后重跑一次测量（两次 getBoundingClientRect，很便宜），
  // 值没变时 `commit` 会原样返回旧对象，不会引发重渲染循环。
  useLayoutEffect(() => {
    measure();
    const element = ref.current;
    const shell = element?.closest(SHELL_SELECTOR) ?? null;
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(() => measure()) : null;
    if (element) observer?.observe(element);
    if (shell instanceof HTMLElement) observer?.observe(shell);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  return useMemo<CSSProperties>(() => {
    if (!measurement) return {};
    const style: Record<string, string> = {
      // 夹取结果只落在这两行上：left 精确算出，right 必须同时清掉（CSS 里是 right: 0）。
      left: `${measurement.left}px`,
      right: "auto",
    };
    if (measurement.tailRight !== null) {
      style["--tt-tail-right"] = `${measurement.tailRight}px`;
    }
    if (measurement.originX !== null) {
      style["--tt-card-origin-x"] = measurement.originX;
    } else {
      // 小贴士的水平居中已经由 left 精确算出，把 translateX(-50%) 退成 0（仍保留
      // 上下贴边用的 translateY），免得两者叠加把气泡推偏半个身位。
      style["--tt-tip-shift-x"] = "0px";
    }
    return style as CSSProperties;
  }, [measurement]);
}
