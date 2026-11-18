// SPDX-License-Identifier: Apache-2.0
/**
 * 缩放锚点的纯几何（QW-7）。
 *
 * 预览的缩放是"改 scale-box 宽高 + 内部 `transform: scale()`"，`transform-origin` 在左上角。
 * 放大时纸向右下长，光标下的内容会被推出视口——用户得再滚回来，这才是"卡顿感"的主因。
 * 修法不是改 `transform-origin`（那是布局测量的基础），而是缩放后**补偿滚动**：
 *
 * ```
 * contentX = (pointerX - boxLeft) / oldScale
 * scroll  += (newBoxLeft + contentX * newScale) - pointerX
 * ```
 *
 * 这里只放纯计算，DOM 量测与滚动赋值留在 `ResumePreview`（它才有滚动容器的 ref）。
 */

export interface Point {
  x: number;
  y: number;
}

/** 光标在**未缩放坐标系**里的位置（相对纸面左上角，单位是纸面 px）。 */
export function contentPoint(pointer: Point, boxStart: Point, scale: number): Point {
  if (!Number.isFinite(scale) || scale <= 0) return { x: 0, y: 0 };
  return {
    x: (pointer.x - boxStart.x) / scale,
    y: (pointer.y - boxStart.y) / scale,
  };
}

/**
 * 缩放后为了让同一个内容点回到光标下，需要给滚动容器加多少偏移。
 *
 * `boxStart` 必须是**缩放后**纸面的视口坐标（`getBoundingClientRect().left/top`），
 * 因为 scale-box 的宽度变了、`margin: 0 auto` 的居中位置也跟着变。
 */
export function scrollDeltaFor(
  content: Point,
  nextScale: number,
  nextBoxStart: Point,
  pointer: Point,
): Point {
  return {
    x: nextBoxStart.x + content.x * nextScale - pointer.x,
    y: nextBoxStart.y + content.y * nextScale - pointer.y,
  };
}

/** 把滚动偏移夹在容器的合法范围内（内容比视口小时返回原值，不做补偿）。 */
export function clampScroll(value: number, viewport: number, content: number): number {
  if (!Number.isFinite(value)) return 0;
  const max = Math.max(0, content - viewport);
  if (max <= 0) return 0;
  return Math.min(max, Math.max(0, value));
}

/**
 * 把光标夹进纸面矩形：鼠标停在大片留白里时，锚点仍应落在纸上，
 * 否则 `contentX` 会是负数，补偿会把纸往反方向推。
 */
export function clampPointerToBox(pointer: Point, box: DOMRect): Point {
  return {
    x: Math.min(box.right, Math.max(box.left, pointer.x)),
    y: Math.min(box.bottom, Math.max(box.top, pointer.y)),
  };
}
