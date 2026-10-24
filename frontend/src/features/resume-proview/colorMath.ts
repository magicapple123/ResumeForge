// SPDX-License-Identifier: Apache-2.0
/**
 * 颜色解析（打印检查用，D10）。
 *
 * 只接受浏览器 `getComputedStyle` 真实会给出的几种写法：`#rgb` / `#rrggbb` /
 * `rgb(r, g, b)` / `rgba(r, g, b, a)`；`transparent` 与无法识别的值返回 `null`
 * （= "没量到"，UI 据此说"暂时量不到"而不是编一个颜色去算对比度）。
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FUNCTION =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i;

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** 解析颜色字符串；透明 / 空 / 非法返回 `null`。 */
export function parseColor(input: string | null | undefined): RgbColor | null {
  if (!input) return null;
  const text = input.trim();
  if (!text || text === "transparent") return null;
  const short = HEX_SHORT.exec(text);
  if (short) {
    return {
      r: Number.parseInt(short[1] + short[1], 16),
      g: Number.parseInt(short[2] + short[2], 16),
      b: Number.parseInt(short[3] + short[3], 16),
    };
  }
  const long = HEX_LONG.exec(text);
  if (long) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
    };
  }
  const rgb = RGB_FUNCTION.exec(text);
  if (rgb) {
    const alpha = rgb[4];
    if (alpha !== undefined) {
      const numeric = alpha.endsWith("%")
        ? Number.parseFloat(alpha) / 100
        : Number.parseFloat(alpha);
      if (Number.isFinite(numeric) && numeric <= 0) return null;
    }
    return {
      r: clampChannel(Number.parseFloat(rgb[1])),
      g: clampChannel(Number.parseFloat(rgb[2])),
      b: clampChannel(Number.parseFloat(rgb[3])),
    };
  }
  return null;
}
