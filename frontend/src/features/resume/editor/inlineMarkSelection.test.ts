// SPDX-License-Identifier: Apache-2.0
/**
 * DF-4 · 选区换算：源串偏移 → 可见文字下标。
 *
 * 这里钉住三条只有"两层编辑"才会错的性质：
 * 1. 对照表覆盖每个可见字符、源串区间跳过隐形标记；
 * 2. 只选标记时不产生高亮（否则是一条没有文字的空蓝带）；
 * 3. 可见总长与 `stripInlineMarks` 同一坐标系（两层错位就会从这里开始）。
 */
import { describe, expect, it } from "vitest";
import { stripInlineMarks } from "./inlineMarkRuns";
import { parseInlineMarkRanges, visibleRangeOfSelection } from "./inlineMarkSelection";

describe("DF-4 · 源串选区 → 可见文字区间", () => {
  const raw = "{@color=#c0392b}个人项目{@}";

  it("对照表覆盖每个可见字符，源串区间跳过标记", () => {
    const ranges = parseInlineMarkRanges(raw);
    expect(ranges.map((r) => r.visibleStart)).toEqual([0, 1, 2, 3]);
    // 第一个可见字在 16 个字符的开标记之后（`{@color=#c0392b}`）。
    expect(ranges[0].rawStart).toBe(16);
    expect(ranges[3].rawEnd).toBe(20);
  });

  it("只选可见文字时拿到完整可见区间；只选标记时返回 null（不画空蓝带）", () => {
    expect(visibleRangeOfSelection(raw, 16, 20)).toEqual({ start: 0, end: 4 });
    expect(visibleRangeOfSelection(raw, 0, 16)).toBeNull();
    expect(visibleRangeOfSelection(raw, 20, raw.length)).toBeNull();
  });

  it("拖选跨过标记：端点向最近的可见字符收缩", () => {
    // 从开标记中间拖到第二个可见字之后。
    expect(visibleRangeOfSelection(raw, 5, 19)).toEqual({ start: 0, end: 3 });
  });

  it("可见总长与 stripInlineMarks 一致（同一坐标系）", () => {
    const sample = "a{@size=0.9}粗{@}**b**[c](https://e.com)";
    const ranges = parseInlineMarkRanges(sample);
    expect(ranges[ranges.length - 1]?.visibleEnd).toBe(stripInlineMarks(sample).length);
  });
});
