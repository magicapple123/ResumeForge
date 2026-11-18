// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记的**选区换算**（DF-4）：源串偏移 ↔ 可见文字下标。
 *
 * 编辑态是两层（上层文本域装源串、下层遮罩画可见字），文本域的 `selectionStart/End`
 * 是**源串**偏移，而高亮必须落在**可见文字**上——直接把源串选区画出来，会在
 * `{@color=…}` 那 20 个隐形字符上拉出一条没有文字的空蓝带。
 *
 * 换算只依赖一个已公开的契约：`parseInlineMarkSegments` 拼回去**恒等于源串**，且
 * `hidden` 段就是源串里"占了宽度但不显示"的那些字符。于是不需要再摸解析内部：
 * 顺着分段累加即可同时得到两套下标。这也让它与遮罩层**用同一份分段**——两层对
 * "哪个字符可见"永远同一个答案。
 */
import { parseInlineMarkSegments } from "./inlineMarkRuns";

/**
 * 一个可见字符的两套区间。
 *
 * `visibleStart/visibleEnd` 以**可见文字**的 UTF-16 下标计（emoji 占 2），与遮罩层逐段
 * 累加出来的下标同一套坐标系；`rawStart/rawEnd` 是它在源串里的位置。
 */
export interface InlineMarkCharRange {
  rawStart: number;
  rawEnd: number;
  visibleStart: number;
  visibleEnd: number;
}

/** 每个**可见**字符的源串区间（隐形标记不占条目）。 */
export function parseInlineMarkRanges(raw: string): InlineMarkCharRange[] {
  if (!raw) return [];
  const ranges: InlineMarkCharRange[] = [];
  let rawCursor = 0;
  let visible = 0;
  for (const segment of parseInlineMarkSegments(raw)) {
    const length = segment.text.length;
    if (segment.hidden) {
      rawCursor += length;
      continue;
    }
    for (let index = 0; index < length; index += 1) {
      ranges.push({
        rawStart: rawCursor + index,
        rawEnd: rawCursor + index + 1,
        visibleStart: visible + index,
        visibleEnd: visible + index + 1,
      });
    }
    rawCursor += length;
    visible += length;
  }
  return ranges;
}

/**
 * 源串选区 → 可见文字区间；只覆盖隐形标记时返回 `null`（不画空蓝带）。
 *
 * 端点落在标记内部时向最近的可见字符收缩——拖选跨过 `{@color=…}` 时，高亮从标记**之后**
 * 的第一个可见字开始，而不是从标记里开始。
 */
export function visibleRangeOfSelection(
  raw: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const ranges = parseInlineMarkRanges(raw);
  if (ranges.length === 0) return null;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  let first = -1;
  let last = -1;
  for (const range of ranges) {
    if (range.rawEnd <= low || range.rawStart >= high) continue;
    if (first < 0) first = range.visibleStart;
    last = range.visibleEnd;
  }
  return first < 0 ? null : { start: first, end: last };
}
