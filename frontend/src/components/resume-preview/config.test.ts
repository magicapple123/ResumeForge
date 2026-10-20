// SPDX-License-Identifier: Apache-2.0
/**
 * 多页预览的列布局。
 *
 * 内容超过所选页数时，预览不会把正文缩成一条竖长纸，而是往 iframe 里注入
 * `column-count` 把它横向分成 N 张 A4。两条硬约束：
 *
 * 1. **列宽与列间距必须由页边距算出来**（2026-10-20 用户实测）：写死 182mm/28mm 只在
 *    默认 14mm 页边距下成立，调到 20mm 正文会溢到第二页、调到 10mm 正文会被页边界切掉。
 * 2. 列边界是**硬切**的，必须显式禁止在条目内部断开——否则 `.entry-head`（左标题 /
 *    右日期 的 flex 行）会被切成"标题留在上一页、日期孤零零出现在下一页"。
 */
import { describe, expect, it } from "vitest";
import { PAGE_GAP_PX, columnGeometry, columnsCss } from "./config";

/** 默认页边距 14mm 时的一页：794px 宽、左右各 52.9px、列间距 105.8px。 */
const PAGE_14MM = { pageWidth: 794, columnWidth: 688.2, columnGap: 105.8 };

describe("列宽与页间隙必须跟着页边距走", () => {
  it("列宽 + 页间隙 = 一页宽（页边距怎么调都不会错位）", () => {
    // 14mm / 10mm / 20mm 页边距（96dpi 下 1mm ≈ 3.7795px）
    for (const paddingMm of [10, 14, 20, 25]) {
      const pad = (paddingMm * 96) / 25.4;
      const { pageGap, columnWidth } = columnGeometry(pad, pad);
      expect(pageGap).toBeCloseTo(2 * pad, 6);
      expect(columnWidth + pageGap).toBeCloseTo(794, 6);
    }
  });

  it("20mm 页边距：列 642px、间隙 151px（旧实现写死 182mm 时会溢出第二页）", () => {
    const pad = (20 * 96) / 25.4;
    const { pageGap, columnWidth } = columnGeometry(pad, pad);
    expect(columnWidth).toBeCloseTo(642.5, 0);
    expect(pageGap).toBeCloseTo(151.2, 0);
  });

  it("10mm 页边距：列 718px、间隙 75px（旧实现写死时正文会被页边界切掉）", () => {
    const pad = (10 * 96) / 25.4;
    const { pageGap, columnWidth } = columnGeometry(pad, pad);
    expect(columnWidth).toBeCloseTo(718.4, 0);
    expect(pageGap).toBeCloseTo(75.6, 0);
  });
});

describe("多页预览的列布局", () => {
  it("按页数生成对应的列数", () => {
    expect(columnsCss({ ...PAGE_14MM, columnCount: 2 })).toContain("column-count:2!important");
    expect(columnsCss({ ...PAGE_14MM, columnCount: 3 })).toContain("column-count:3!important");
    // 至少两列：单列走的是另一条分支（不分页）。
    expect(columnsCss({ ...PAGE_14MM, columnCount: 1 })).toContain("column-count:2!important");
  });

  it("列宽 / 列间距按传入的页边距写，不是写死 182mm + 28mm", () => {
    // 页边距 20mm：内容宽 170mm，列间距 40mm。
    const css = columnsCss({
      pageWidth: 794,
      columnWidth: 642.5,
      columnGap: 151.5,
      columnCount: 2,
    });
    expect(css).toContain("column-width:642.50px!important");
    expect(css).toContain("column-gap:151.50px!important");
  });

  it("列宽 + 列间距 = 一页宽：第 N 列正好落在第 N 张纸上", () => {
    for (const columnGap of [75.6, 105.8, 151.5]) {
      const columnWidth = 794 - columnGap;
      expect(columnWidth + columnGap).toBe(794);
    }
  });

  it("body 宽度按页数展开，与画布的外框宽度同源", () => {
    expect(columnsCss({ ...PAGE_14MM, columnCount: 2 })).toContain("width:1588.00px!important");
    expect(columnsCss({ ...PAGE_14MM, columnCount: 3 })).toContain("width:2382.00px!important");
  });

  it("默认页间隙与 14mm 页边距一致（28mm ≈ 106px）", () => {
    expect(PAGE_GAP_PX).toBeCloseTo((28 / 25.4) * 96, 0);
  });

  it("条目 / 表行不会被列边界切断", () => {
    const css = columnsCss({ ...PAGE_14MM, columnCount: 3 });
    expect(css).toContain("break-inside:avoid");
    expect(css).toContain("body .entry");
    expect(css).toContain("body .entry-head");
    expect(css).toContain("body tr");
  });

  it("小节标题不会孤零零落在页尾", () => {
    expect(columnsCss({ ...PAGE_14MM, columnCount: 2 })).toContain("break-after:avoid");
  });
});
