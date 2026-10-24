// SPDX-License-Identifier: Apache-2.0
/**
 * 照片裁剪的**清晰度提示**（D09）。
 *
 * 判定基准是"纸面打印 dpi"，不是屏幕像素：同样 800px 宽的照片，放在 20mm 的照片框里
 * 有约 1016dpi，放在 60mm 的框里只剩约 338dpi。所以提示必须由调用方传入纸面实际宽度
 * （从预览 iframe 里量 `.profile-photo` 的 CSS 宽度再换算成 mm），量不到时用兜底值
 * 并如实说明"按约 30mm 估算"——不编一个漂亮的数字。
 */
import type { PhotoCropParams } from "./photoCrop";

/** 量不到纸面宽度时的兜底（mm）：常见简历照片框约 25–35mm 宽。 */
export const DEFAULT_PRINTED_WIDTH_MM = 30;
/** 低清提示门槛：低于这个 dpi 打印大概率发虚（照片理想值 300dpi）。 */
export const MIN_PRINT_DPI = 200;
/** CSS px → mm（96dpi 基准：794px ≈ 210mm，正是 A4 的既有换算）。 */
export function printedWidthMm(cssPx: number): number {
  if (!Number.isFinite(cssPx) || cssPx <= 0) return DEFAULT_PRINTED_WIDTH_MM;
  return (cssPx * 25.4) / 96;
}

/** 裁剪后的有效像素。 */
export function cropPixelSize(params: PhotoCropParams): { width: number; height: number } {
  const width = Math.max(1, Math.round(params.source.width * params.rect.w));
  const height = Math.max(1, Math.round(params.source.height * params.rect.h));
  return { width, height };
}

export interface PrintClarity {
  level: "ok" | "warn" | "unknown";
  /** 裁剪后像素宽。 */
  pixelWidth: number;
  pixelHeight: number;
  /** 按纸面宽度换算的打印 dpi（不是屏幕 dpi）。 */
  dpi: number;
  /** 纸面宽度（mm），用于 UI 提示"按 xxx 毫米估算"。 */
  printedWidthMm: number;
}

/**
 * 清晰度估算：按照片在纸面上的实际宽度把裁剪后的像素折算成打印 dpi。
 *
 * 低于 `MIN_PRINT_DPI` 时给 warn（打印会发虚），但不阻止保存——参数是用户的决定，
 * UI 只负责把后果说清（与项目"不自动缩字号 / 不自动改稿"同一口径）。
 */
export function estimatePrintClarity(
  params: PhotoCropParams,
  printedWidthMmValue: number = DEFAULT_PRINTED_WIDTH_MM,
): PrintClarity {
  const { width, height } = cropPixelSize(params);
  const mm = printedWidthMmValue > 0 ? printedWidthMmValue : DEFAULT_PRINTED_WIDTH_MM;
  const dpi = Math.round((width * 25.4) / mm);
  return {
    level: dpi >= MIN_PRINT_DPI ? "ok" : "warn",
    pixelWidth: width,
    pixelHeight: height,
    dpi,
    printedWidthMm: Math.round(mm * 10) / 10,
  };
}
