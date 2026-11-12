// SPDX-License-Identifier: Apache-2.0
/**
 * 缩放档位的**唯一**几何口径（D04）。
 *
 * `ResumePreview` 的既有状态是「缩放系数 zoom」（1 = 按 fit 比例）。本模块把它翻译成
 * 三个用户能理解的档位，并**反推当前命中哪个档位**——档位不另存一份 state：
 *
 * - 存 state 就必须处理"用户按了 Ctrl+滚轮/缩略条之后档位该不该取消高亮"，
 *   而任何一处漏掉都会出现"读数 125% 但「整页」仍亮着"的矛盾；
 * - 反推只需要 `fitScale`、`viewportWidth`、`pageWidth` 三个量（都是画布已经算出来的）。
 *
 * 注意"100%"是**逻辑像素**：纸面 794 CSS px 宽，屏幕上的物理大小取决于系统显示缩放，
 * 文案里必须声明（见 `proview.zoom.actualNote`），不能承诺"一张 A4 的实际尺寸"。
 */
import type { ZoomMode } from "./types";

/** 命中容差：百分比读数取整到 1%，档位判定不能比读数更严。 */
const MODE_TOLERANCE = 0.005;

export interface ZoomGeometry {
  /** 视口按一页完整显示时的缩放（geometry.fitScale）。 */
  fitScale: number;
  /** 画布可用的宽度（px）。 */
  viewportWidth: number;
  /** 一页的未缩放宽度（A4 = 794）。 */
  pageWidth: number;
}

/** 某一档位对应的**绝对**缩放（不是 zoom 系数）。 */
export function scaleForMode(mode: ZoomMode, geometry: ZoomGeometry): number {
  if (mode === "page") return geometry.fitScale;
  if (mode === "width") {
    return geometry.pageWidth > 0 ? geometry.viewportWidth / geometry.pageWidth : 1;
  }
  return 1;
}

/**
 * 某一档位对应的 zoom 系数（喂给 `ResumePreview` 的 `setZoom`）。
 *
 * `fitScale` 为 0 的退化情况（首帧还没量到）返回 1：让画布按它自己的 fit 渲染，
 * 下一帧量到真实宽度后 ProviewLayer 会重新算一次。
 */
export function zoomFactorForMode(mode: ZoomMode, geometry: ZoomGeometry): number {
  const fitScale = geometry.fitScale > 0 ? geometry.fitScale : 1;
  return scaleForMode(mode, geometry) / fitScale;
}

/** 当前绝对缩放命中哪个档位；都不命中（用户手动缩放过）返回 `null`。 */
export function resolveZoomMode(scale: number, geometry: ZoomGeometry): ZoomMode | null {
  if (!Number.isFinite(scale) || scale <= 0) return null;
  // 顺序有意义：`actual` 排在 `width` 前。视口宽恰好等于页宽（794）时两档数值相同，
  // 此时用户点的是「100%」——优先报具体档位，而不是把「适宽」也点亮成同一状态。
  const candidates: ZoomMode[] = ["page", "actual", "width"];
  for (const mode of candidates) {
    const target = scaleForMode(mode, geometry);
    if (target > 0 && Math.abs(scale - target) <= MODE_TOLERANCE) return mode;
  }
  return null;
}

/** 读数用的整数百分比。 */
export function zoomPercent(scale: number): number {
  if (!Number.isFinite(scale)) return 100;
  return Math.round(scale * 100);
}

/**
 * 手动缩放系数（缩略条 +/- 与 Ctrl+滚轮共用）的区间。
 *
 * 绝对缩放本身还会被 `ResumePreview` 的 geometry 再夹一次（可读下限 / MAX_ZOOM），
 * 这里只守住系数层的边界：反复点 + 不会把系数堆到无穷大。
 */
export const MIN_ZOOM_FACTOR = 0.3;
export const MAX_ZOOM_FACTOR = 6;

export function clampZoomFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, factor));
}
