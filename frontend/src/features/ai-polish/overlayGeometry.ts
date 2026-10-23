// SPDX-License-Identifier: Apache-2.0
/**
 * AI 润色浮层的几何计算：菜单/卡片贴着指针与选区落位时的夹取。
 *
 * 从 `features/ai-polish/AiPolishLayer.tsx` 拆出来（2026-10-23）：那个文件是组件文件，
 * 再导出普通函数会让 `react-refresh/only-export-components` 失效。这里只放与 React
 * 无关的类型与常量，卡片、菜单两边共用同一套夹取口径（`clamp` 只有一份实现）。
 */
import type { SelectionTarget } from "./selectionTarget";

/** 与视口边缘的最小间距。 */
export const VIEWPORT_MARGIN = 8;
export const CARD_WIDTH = 344;
/** 卡片高度的估算值：只用于"不要整张掉出视口"的夹取。 */
export const CARD_ESTIMATED_HEIGHT = 420;
/** 卡片与菜单之间留一点缝，避免两张浮层贴在一起。 */
export const CARD_GAP = 6;

export interface Anchor {
  left: number;
  top: number;
}

export interface MenuState {
  /** 指针位置（已夹进视口）。 */
  x: number;
  y: number;
  /** 选区在可编辑元素里时才有；决定菜单里出不出现「AI 润色」。 */
  target: SelectionTarget | null;
  /** 选中的文字。非可编辑区里没有 `target`，只能靠它复制。 */
  text: string;
}

export function clamp(value: number, min: number, max: number): number {
  // 视口窄于控件时 max < min：此时贴着左边，保证起点可见。
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 卡片贴着**指针/选区**出现（2026-10-20 修）。
 *
 * 原来固定往下让开整个右键菜单的高度（210px），于是卡片总在点击处下方两百多像素，
 * 看起来"飘"在很远的地方。菜单在点「AI 润色」后立刻关闭，卡片完全可以占用它的位置。
 *
 * 规则：默认落在指针右下方一点；下方放不下就翻到上方；横向夹进视口。
 * 卡片自身还有 `max-height` 兜底，估算高度偏差不会让它掉出屏幕。
 */
export function cardAnchor(menu: MenuState): Anchor {
  const gap = CARD_GAP + 2;
  const left = clamp(
    menu.x + gap,
    VIEWPORT_MARGIN,
    window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN,
  );
  const maxTop = window.innerHeight - CARD_ESTIMATED_HEIGHT - VIEWPORT_MARGIN;
  const below = menu.y + gap;
  // 上方也要留出至少一屏 1/3 的可视高度，否则还不如贴顶显示。
  const above = menu.y - CARD_ESTIMATED_HEIGHT - gap;
  const top =
    below <= maxTop
      ? below
      : above >= VIEWPORT_MARGIN
        ? above
        : clamp(below, VIEWPORT_MARGIN, maxTop);
  return { left, top };
}
