// SPDX-License-Identifier: Apache-2.0
/**
 * 浮层落点：**下方优先，放不下翻到上方**，水平方向按视口夹取。
 *
 * 两处共用同一份逻辑（仓库要求"一处逻辑一份实现"）：
 * - 投投划词浮条（`features/tou-tou/touTouSelection.selectionMenuPosition`，以选区矩形
 *   中心对齐）；
 * - 简历制作台的行内格式右键菜单（`features/resume/layout/InlineMarkContextMenu`，以
 *   光标点为左上角、左边缘对齐）。
 *
 * 只接收数字，不读 DOM：调用方负责量视口、浮层与锚点，因此可以脱离浏览器布局直接测。
 */

export interface PlacementRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface PlacementSize {
  width: number;
  height: number;
}

export type PlacementSide = "below" | "above";

export interface AnchoredPlacement {
  /** 浮层顶边（视口坐标）。 */
  top: number;
  /** 浮层左边（视口坐标）。 */
  left: number;
  /** 最终落在锚点哪一侧（"below" 也用于两侧都放不下时的夹取兜底）。 */
  side: PlacementSide;
}

export interface AnchoredPlacementOptions {
  /** 浮层与锚点之间的间距。 */
  gap?: number;
  /** 浮层与视口边缘的最小距离（默认 0：调用方自己决定是否留边）。 */
  margin?: number;
  /**
   * 水平对齐方式：
   * - `center`（默认）：浮层中心贴锚点中心（划词浮条）；
   * - `start`：浮层左边缘贴锚点左边缘（右键菜单跟随光标）。
   */
  alignX?: "center" | "start";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

/**
 * 计算浮层落点。
 *
 * 规则（顺序固定，不要调换）：
 * 1. 下方：`anchor.bottom + gap` 放得进视口（减去 margin 与浮层高度）就用下方；
 * 2. 否则翻到上方：浮层底边贴 `anchor.top - gap`；
 * 3. 上下都放不下（浮层比视口还高）：退回下方并夹进视口——此时由调用方的
 *    `max-height` + 内部滚动兜底，不再继续挪动；
 * 4. 水平方向始终夹进 `[margin, viewportWidth - width - margin]`。
 */
export function anchoredPlacement(
  anchor: PlacementRect,
  viewport: PlacementSize,
  menu: PlacementSize,
  options: AnchoredPlacementOptions = {},
): AnchoredPlacement {
  const gap = options.gap ?? 0;
  const margin = options.margin ?? 0;
  const alignX = options.alignX ?? "center";

  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const rawLeft =
    alignX === "center" ? anchor.left + anchor.width / 2 - menu.width / 2 : anchor.left;
  const left = clamp(rawLeft, margin, maxLeft);

  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  const below = anchor.bottom + gap;
  if (below <= maxTop) return { top: below, left, side: "below" };

  const above = anchor.top - gap - menu.height;
  if (above >= margin) return { top: above, left, side: "above" };

  return { top: clamp(below, margin, maxTop), left, side: "below" };
}

/**
 * 把「宿主左上角」与「目标落点」换算成 Dropdown 的 `targetOffset`。
 *
 * `@rc-component/trigger` 的语义是**从目标矩形里减去** targetOffset
 * （`useAlign.js`: `targetRect.x -= targetOffsetX`），所以这里必须给
 * `host − placement`；写成 `placement − host` 会把菜单以宿主为轴镜像偏移
 * （2026-11-18 实机复核发现的老实现就是这个错）。
 */
export function triggerTargetOffset(
  host: { left: number; top: number },
  placement: { left: number; top: number },
): [number, number] {
  return [host.left - placement.left, host.top - placement.top];
}
