// SPDX-License-Identifier: Apache-2.0
/**
 * 照片裁剪框的**纯几何**（2026-11 #18）：把"指针位置"与"裁剪矩形"之间的换算全部
 * 收敛到这里，组件只负责把结果画出来。
 *
 * ## 为什么需要这一层
 *
 * 1. **显示区是 `object-fit: contain`**：图片在容器里可能带 letterbox（上下或左右留白），
 *    指针坐标不能直接除以容器尺寸。`fitContain` 先算出"图片实际显示的那块矩形"，
 *    `normalizePoint` / `normalizedDelta` 再从指针位置里减掉留白。照片越接近正方形、
 *    留白越少，错位越不明显——越容易漏测，所以这层必须是可单测的纯函数。
 * 2. **拖动中允许自由变形、松手才夹比例**：两段逻辑必须能分开调（`resizeCropRect` 与
 *    `photoCrop.fitCropRectToAspect`），否则"拖动即夹"会让框粘住鼠标。
 * 3. **键盘可操作**：手柄是 div，方向键微调走 `nudgeCropRect`，与指针拖动共用同一套
 *    夹取与等比逻辑，不出现"鼠标能拖到、键盘拖不到"的两套边界。
 *
 * 所有量都在**归一化原图坐标**（0–1）里算；像素换算只发生在入口（指针位移）与出口
 * （百分比样式）。这里不引任何 DOM 或 React 类型，便于 vitest 直接覆盖。
 */
import type { CropRect } from "./photoCrop";

/** 八个手柄：四边 + 四角。 */
export type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

/** 渲染顺序：先边后角（角要盖在边上面，不然角被边挡住点不到）。 */
export const CROP_HANDLES: readonly CropHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** 尺寸（px）。 */
export interface Size {
  width: number;
  height: number;
}

/** 矩形（px，左上角坐标）。 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 百分比矩形（相对显示区，0–100）。 */
export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 位移（归一化原图坐标）。 */
export interface Delta {
  x: number;
  y: number;
}

function clampBetween(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clampBetween(value, 0, 1);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 手柄的朝向：-1 = 上/左，0 = 该轴不动，1 = 下/右。 */
export function handleDirection(handle: CropHandle): Delta {
  return {
    x: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
    y: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0,
  };
}

/** 手柄光标（四角用对角箭头）。 */
export function handleCursor(handle: CropHandle): string {
  const { x, y } = handleDirection(handle);
  if (x === 0) return "ns-resize";
  if (y === 0) return "ew-resize";
  return x === y ? "nwse-resize" : "nesw-resize";
}

/**
 * `object-fit: contain` 后图片**实际显示**的矩形（相对容器，px）。
 *
 * 容器比图片"胖"时左右留白，比图片"高"时上下留白——这就是必须从指针坐标里减掉的
 * letterbox。容器或图片尺寸不可用时退化成"铺满容器"，让框仍然能画出来。
 */
export function fitContain(stage: Size, image: Size): Box {
  const stageWidth = Math.max(1, stage.width);
  const stageHeight = Math.max(1, stage.height);
  const imageWidth = Math.max(1, image.width);
  const imageHeight = Math.max(1, image.height);
  const scale = Math.min(stageWidth / imageWidth, stageHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
    width,
    height,
  };
}

/**
 * 指针位置 → 归一化原图坐标。
 *
 * `stage` 是容器的 **client** 矩形（`getBoundingClientRect()`），`image` 是
 * `fitContain` 的结果（相对容器）。两步都不可省：先减容器在视口里的位置，
 * 再减图片在容器里的留白。
 */
export function normalizePoint(clientX: number, clientY: number, stage: Box, image: Box): Delta {
  const x = image.width > 0 ? (clientX - stage.left - image.left) / image.width : 0;
  const y = image.height > 0 ? (clientY - stage.top - image.top) / image.height : 0;
  return { x: clamp01(x), y: clamp01(y) };
}

/** 指针位移 → 归一化位移（拖动中不夹到 0–1：位移超出边界交给矩形夹取处理）。 */
export function normalizedDelta(
  clientX: number,
  clientY: number,
  startClientX: number,
  startClientY: number,
  image: Box,
): Delta {
  return {
    x: image.width > 0 ? (clientX - startClientX) / image.width : 0,
    y: image.height > 0 ? (clientY - startClientY) / image.height : 0,
  };
}

/** 归一化矩形 → 显示区百分比（框、遮罩、手柄都按这个定位）。 */
export function cropBoxPercent(rect: CropRect, stage: Size, image: Box): PercentBox {
  const stageWidth = Math.max(1, stage.width);
  const stageHeight = Math.max(1, stage.height);
  return {
    left: ((image.left + rect.x * image.width) / stageWidth) * 100,
    top: ((image.top + rect.y * image.height) / stageHeight) * 100,
    width: ((rect.w * image.width) / stageWidth) * 100,
    height: ((rect.h * image.height) / stageHeight) * 100,
  };
}

/**
 * 框外压暗遮罩的四块（上/下/左/右）。
 *
 * 用四块而不是一块 + `clip-path`：`pointer-events: none` 的普通 div 在各浏览器上
 * 表现一致，而且"四块"这个结构本身能被断言（少一块就有漏光）。
 */
export function maskBoxes(box: PercentBox): PercentBox[] {
  const left = clampBetween(box.left, 0, 100);
  const top = clampBetween(box.top, 0, 100);
  const width = clampBetween(box.width, 0, 100 - left);
  const height = clampBetween(box.height, 0, 100 - top);
  return [
    { left: 0, top: 0, width: 100, height: top },
    { left: 0, top: top + height, width: 100, height: Math.max(0, 100 - top - height) },
    { left: 0, top, width: left, height },
    { left: left + width, top, width: Math.max(0, 100 - left - width), height },
  ];
}

export interface ResizeOptions {
  handle: CropHandle;
  /** 指针位移（归一化原图坐标）。 */
  delta: Delta;
  /** 最小边长（归一化），与 `photoCrop.MIN_CROP_SIZE` 同口径。 */
  minSize: number;
  /** 等比缩放（按住 Ctrl / Cmd 时打开）：冻结拖动开始时的宽高比。 */
  lockAspect: boolean;
}

/**
 * 拖动一个手柄 → 新矩形（**允许自由变形**，比在这里夹）。
 *
 * - 非等比：只有被拖的那条边/那个角动，另外的轴完全不变（验收 1）；
 * - 等比（Ctrl / Cmd）：以"不动的那个角/中心"为锚，`w` 与 `h` 同比例缩放（验收 2）。
 */
export function resizeCropRect(start: CropRect, options: ResizeOptions): CropRect {
  const min = clampBetween(options.minSize, 0.01, 1);
  const { handle, delta, lockAspect } = options;
  if (!(start.w > 0) || !(start.h > 0)) return start;
  if (lockAspect) return resizeLocked(start, handle, delta, min);

  let { x, y, w, h } = start;
  const direction = handleDirection(handle);

  if (direction.x < 0) {
    const nextX = clampBetween(x + delta.x, 0, x + w - min);
    w = x + w - nextX;
    x = nextX;
  } else if (direction.x > 0) {
    w = clampBetween(w + delta.x, min, 1 - x);
  }
  if (direction.y < 0) {
    const nextY = clampBetween(y + delta.y, 0, y + h - min);
    h = y + h - nextY;
    y = nextY;
  } else if (direction.y > 0) {
    h = clampBetween(h + delta.y, min, 1 - y);
  }
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

/**
 * 等比缩放：锚点是"不动的那个角"，边手柄则以对边的**中点**为锚。
 *
 * 归一化坐标里 `w/h` 恒定 ⇒ 像素宽高比恒定（两边同乘原图宽高），所以这里只守
 * `start.w / start.h`，不引入原图尺寸。
 */
function resizeLocked(start: CropRect, handle: CropHandle, delta: Delta, min: number): CropRect {
  const direction = handleDirection(handle);
  const scaleFromWidth =
    direction.x > 0
      ? (start.w + delta.x) / start.w
      : direction.x < 0
        ? (start.w - delta.x) / start.w
        : 1;
  const scaleFromHeight =
    direction.y > 0
      ? (start.h + delta.y) / start.h
      : direction.y < 0
        ? (start.h - delta.y) / start.h
        : 1;
  // 角手柄：取"变化更明显"的那个轴，避免斜向拖动时手感发钝。
  let scale = 1;
  if (direction.x !== 0 && direction.y !== 0) {
    scale =
      Math.abs(scaleFromHeight - 1) > Math.abs(scaleFromWidth - 1)
        ? scaleFromHeight
        : scaleFromWidth;
  } else if (direction.x !== 0) {
    scale = scaleFromWidth;
  } else if (direction.y !== 0) {
    scale = scaleFromHeight;
  }

  const anchorX =
    direction.x > 0 ? start.x : direction.x < 0 ? start.x + start.w : start.x + start.w / 2;
  const anchorY =
    direction.y > 0 ? start.y : direction.y < 0 ? start.y + start.h : start.y + start.h / 2;
  const maxWidth =
    direction.x > 0 ? 1 - anchorX : direction.x < 0 ? anchorX : 2 * Math.min(anchorX, 1 - anchorX);
  const maxHeight =
    direction.y > 0 ? 1 - anchorY : direction.y < 0 ? anchorY : 2 * Math.min(anchorY, 1 - anchorY);
  const maxScale = Math.min(maxWidth / start.w, maxHeight / start.h);
  const minScale = min / Math.min(start.w, start.h);
  scale = clampBetween(scale, Math.min(minScale, maxScale), Math.max(minScale, maxScale));

  const w = start.w * scale;
  const h = start.h * scale;
  const x = direction.x > 0 ? anchorX : direction.x < 0 ? anchorX - w : anchorX - w / 2;
  const y = direction.y > 0 ? anchorY : direction.y < 0 ? anchorY - h : anchorY - h / 2;
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

/**
 * 方向键 → 归一化位移（1% / Shift 5% 由调用方给 `step`）。
 *
 * 位移方向按"指针往哪走"而不是"框变大变小"：手柄在东边按 → 是往右拉，
 * 在西边按 ← 也是往右拉（框变小）。这样鼠标与键盘共用同一套夹取。
 */
export function arrowDelta(handle: CropHandle, key: ArrowKey, step: number): Delta | null {
  const direction = handleDirection(handle);
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (direction.x === 0) return null;
    return { x: key === "ArrowRight" ? step : -step, y: 0 };
  }
  if (direction.y === 0) return null;
  return { x: 0, y: key === "ArrowDown" ? step : -step };
}

/** 方向键微调一个手柄（与拖动共用同一套几何）。 */
export function nudgeCropRect(
  rect: CropRect,
  handle: CropHandle,
  key: ArrowKey,
  step: number,
  options: { minSize: number; lockAspect: boolean },
): CropRect {
  const delta = arrowDelta(handle, key, step);
  if (!delta) return rect;
  return resizeCropRect(rect, { handle, delta, ...options });
}
