// SPDX-License-Identifier: Apache-2.0
/**
 * 右键菜单的落位计算：贴指针、下方放不下就翻到上方、四边都夹进视口。
 *
 * 从 `features/ai-polish/overlayGeometry.ts` 的 `clamp` + `cardAnchor` 提升而来（2026-11-04）：
 * 那份实现里带着 `CARD_WIDTH` / `CARD_ESTIMATED_HEIGHT` 这种 ai-polish 专属常量，只有
 * 卡片自己能用。这里改成**由调用方传尺寸**（先测量后定位），四个菜单共用同一份夹取口径。
 *
 * 纯函数、不读 React、不读 DOM 之外的任何东西：`window.innerWidth/innerHeight` 由参数读取，
 * 单测里可以直接摆四个角验证"不越出视口"。
 */

/** 与视口边缘的最小间距：菜单贴着边框会看起来像被裁掉。 */
export const VIEWPORT_MARGIN = 8;

/**
 * 指针与菜单左上角之间的缝隙。
 *
 * 与 antd `alignPoint` 的 0 偏移差 ≤4px，属于已接受的差异（见问题清单问题 25「风险与取舍」）：
 * 自绘浮层留 4px 是为了让指针不压住第一项的文字。
 */
export const MENU_GAP = 4;

/** 指针位置（视口坐标）。 */
export interface Point {
  x: number;
  y: number;
}

/** 浮层尺寸：调用方测量后传入，量不到时用估算值兜底。 */
export interface MenuSize {
  width: number;
  height: number;
}

/** 计算后的左上角（视口坐标，供 `position: fixed` 直接使用）。 */
export interface MenuPlacement {
  left: number;
  top: number;
}

/** 夹进 [min, max]；视口比控件还窄时贴左边，保证起点可见。 */
export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export interface PlaceMenuOptions {
  margin?: number;
  gap?: number;
  /** 视口尺寸；默认读 `window`，单测可以显式传入。 */
  viewport?: MenuSize;
}

/**
 * 贴指针落位。
 *
 * - 横向：优先指针右侧 4px，右侧放不下就向左夹进视口；
 * - 纵向：优先指针下方 4px，下方放不下就翻到指针上方，上方也放不下再夹进视口。
 *
 * 这样四个角（左上/右上/左下/右下）右键都能完整看到菜单。
 */
export function placeMenu(
  point: Point,
  size: MenuSize,
  options: PlaceMenuOptions = {},
): MenuPlacement {
  const margin = options.margin ?? VIEWPORT_MARGIN;
  const gap = options.gap ?? MENU_GAP;
  const viewport = options.viewport ?? {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  const left = clamp(point.x + gap, margin, viewport.width - size.width - margin);

  const below = point.y + gap;
  const above = point.y - size.height - gap;
  const maxTop = viewport.height - size.height - margin;
  // 先决定翻上还是放下，再统一夹一次：指针贴着上边框时 `below` 也可能小于 margin。
  const chosen = below <= maxTop ? below : above >= margin ? above : below;
  const top = clamp(chosen, margin, maxTop);

  return { left, top };
}
