// SPDX-License-Identifier: Apache-2.0
/**
 * 条目「分栏」的纯几何计算：列宽百分比、列间距的 mm↔em 换算、拖动时的边界与吸附。
 *
 * 为什么单独一层：同样的数字既要给控件显示（mm），又要落进 format_config（em 比例，
 * 跟着字号缩放），还要给 PDF/Word 的栏宽换算用。放一处才能保证"界面上看到 3.20 mm"
 * 和"导出时真的是 3.20 mm"是同一个公式。
 *
 * 三条约定（改之前先看）：
 * - 列宽永远是**百分比且合计 100**；每列保底 `MIN_COLUMN_PERCENT`，否则分隔条会拖到
 *   找不回来、文字也会被挤成一列一个字；
 * - 间距存的是 **em 比例**（相对字号），不是 mm：同一份版式换字号档位后间距要跟着缩；
 * - `justify="between"` 时列宽计算**不扣间距**：CSS 的 space-between 把剩余空间全给了
 *   间隔，列宽本身仍按可用宽均分。
 */

export const MAX_GAP_MM = 8;
// 1px = 1/96 inch = 0.26458mm；这里取 0.2646 是为了和 PDF 侧的 _PX_TO_MM 对得上。
export const FONT_PX_TO_MM = 0.2646;
export const MIN_COLUMN_PERCENT = 10;

const WIDTH_PRECISION = 100;
const MIN_COLUMN_PX = 60;

export interface GapGeometry {
  gapPx: number | null;
  columnPx: number | null;
  tooNarrow: boolean;
}

export function gapGeometry(
  columns: number,
  gap: number | null,
  fontPx: number | null,
  contentPx: number | null,
  justify: "start" | "between" = "start",
): GapGeometry {
  const gapPx = gap !== null && fontPx !== null ? Math.round(gap * fontPx) : null;
  const squeeze = justify === "between" ? 0 : (gap ?? 0);
  const columnPx =
    contentPx !== null && fontPx !== null && columns > 0
      ? (contentPx - Math.max(0, columns - 1) * squeeze * fontPx) / columns
      : null;
  return {
    gapPx,
    columnPx,
    // 只有三栏才会真的挤：两栏即使吃满 8mm，每列还有半页宽，提示只会变成噪音。
    tooNarrow: columns === 3 && columnPx !== null && columnPx < MIN_COLUMN_PX,
  };
}

export function equalWidths(columns: number): number[] {
  const base = Math.floor(100 / columns);
  const widths = Array.from({ length: columns }, () => base);
  // 除不尽的余数给第一列：合计必须精确 100，否则最后一列会留下 0.33% 的缝。
  widths[0] += 100 - base * columns;
  return widths;
}

export function columnWidthSum(widths: number[]): number {
  return widths.reduce((total, width) => total + width, 0);
}

export function initialGaps(columns: number, gap: number | null): number[] {
  return Array.from({ length: Math.max(0, columns - 1) }, () => gap ?? 1.2);
}

export function normalizeColumnWidths(widths: number[]): number[] {
  if (widths.length < 2) return widths.length === 1 ? [100] : [];
  const remaining = 100 - MIN_COLUMN_PERCENT * widths.length;
  const weights = widths.map((width) =>
    Math.max(0, (Number.isFinite(width) ? width : MIN_COLUMN_PERCENT) - MIN_COLUMN_PERCENT),
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const normalized = weights.map(
    (weight) =>
      MIN_COLUMN_PERCENT +
      remaining * (weightTotal === 0 ? 1 / widths.length : weight / weightTotal),
  );
  const rounded = normalized.map((width) => Math.round(width * WIDTH_PRECISION) / WIDTH_PRECISION);
  const difference =
    Math.round((100 - columnWidthSum(rounded)) * WIDTH_PRECISION) / WIDTH_PRECISION;
  // 四舍五入的尾差补给**最宽**那列：补给最窄的会把它顶过保底值，看起来像"改一下全变了"。
  const receiver = rounded.indexOf(Math.max(...rounded));
  rounded[receiver] =
    Math.round((rounded[receiver] + difference) * WIDTH_PRECISION) / WIDTH_PRECISION;
  return rounded;
}

export function moveColumnDivider(
  widths: number[],
  dividerIndex: number,
  deltaPercent: number,
): number[] {
  if (dividerIndex < 0 || dividerIndex >= widths.length - 1) return widths;
  const left = widths[dividerIndex];
  const right = widths[dividerIndex + 1];
  const pairWidth = left + right;
  // 只重分相邻两列：合计不变，别的列不会因为拖这一条而跟着跳。
  const nextLeft = Math.min(
    pairWidth - MIN_COLUMN_PERCENT,
    Math.max(MIN_COLUMN_PERCENT, left + deltaPercent),
  );
  const roundedLeft = Math.round(nextLeft * WIDTH_PRECISION) / WIDTH_PRECISION;
  const next = [...widths];
  next[dividerIndex] = roundedLeft;
  next[dividerIndex + 1] =
    Math.round((pairWidth - roundedLeft) * WIDTH_PRECISION) / WIDTH_PRECISION;
  return next;
}

export function snapColumnWidths(widths: number[], tolerance = 1): number[] {
  const candidates =
    widths.length === 2
      ? [equalWidths(2), [65, 35], [35, 65]]
      : widths.length === 3
        ? [equalWidths(3)]
        : [];
  const match = candidates.find((candidate) =>
    candidate.every((value, index) => Math.abs(widths[index] - value) <= tolerance),
  );
  // 只在松手时调用：拖动中吸附会让分隔条"粘手"，1% 的容差足够覆盖手抖。
  return match ? [...match] : widths;
}

export function ratioToMillimeters(ratio: number, fontPx: number | null): number | null {
  return fontPx !== null && fontPx > 0 ? ratio * fontPx * FONT_PX_TO_MM : null;
}

export function millimetersToRatio(millimeters: number, fontPx: number | null): number | null {
  return fontPx !== null && fontPx > 0 ? millimeters / (fontPx * FONT_PX_TO_MM) : null;
}
