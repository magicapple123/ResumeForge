// SPDX-License-Identifier: Apache-2.0
/**
 * 预览几何：**多页横向并排**（用户 2026-10-20 选定的形态），
 * 唯一的例外是 **1 页上限**——那时不因溢出而多排一列，超出部分直接裁掉。
 */
import { describe, expect, it } from "vitest";
import { A4_HEIGHT_PX, A4_WIDTH_PX, PAGE_STACK_GAP_PX } from "./config";
import { calculatePreviewGeometry } from "./geometry";

function geometry(pageCount: number, options: { overflow?: boolean; naturalWidth?: number } = {}) {
  return calculatePreviewGeometry({
    availableSpace: { width: A4_WIDTH_PX, height: A4_HEIGHT_PX },
    paperHeight: A4_HEIGHT_PX * pageCount,
    pageCount,
    zoom: 1,
    overflow: options.overflow ?? false,
    naturalWidth: options.naturalWidth ?? A4_WIDTH_PX * pageCount,
    pageGap: 106,
    measure: null,
  });
}

describe("预览几何：多页竖向堆叠", () => {
  it("2 / 3 页竖排：宽仍是一页，高 = 页数 × A4 + 页间距", () => {
    for (const pages of [2, 3]) {
      const result = geometry(pages);
      // 2026-10-21 起多页是**上下摞**（原来是左右并排）：横向并排要看第 2 页得先横滚。
      expect(result.contentTotalWidth).toBe(A4_WIDTH_PX);
      expect(result.contentTotalHeight).toBe(
        A4_HEIGHT_PX * pages + PAGE_STACK_GAP_PX * (pages - 1),
      );
      expect(result.totalVisualPages).toBe(pages);
      // 竖排后画布不再画"页间隙条"：页与页之间是真实空白。
      expect(result.separatorCount).toBe(0);
      expect(result.overflowClipped).toBe(false);
    }
  });

  it("1 页上限 + 内容溢出：不再向右展开，超出的部分裁掉", () => {
    // naturalWidth 说明"如果展开会有两列"，但 1 页上限不吃这一套。
    const result = geometry(1, { overflow: true, naturalWidth: A4_WIDTH_PX * 2 });
    expect(result.contentTotalWidth).toBe(A4_WIDTH_PX);
    expect(result.contentTotalHeight).toBe(A4_HEIGHT_PX);
    expect(result.totalVisualPages).toBe(1);
    expect(result.separatorCount).toBe(0);
    expect(result.overflowClipped).toBe(true);
    // 提示仍如实说"约需 2 页"。
    expect(result.pagesNeeded).toBe(2);
  });

  it("1 页装得下时是一张 A4、不显示分页线", () => {
    const result = geometry(1);
    expect(result.contentTotalWidth).toBe(A4_WIDTH_PX);
    expect(result.totalVisualPages).toBe(1);
    expect(result.separatorCount).toBe(0);
    expect(result.overflowClipped).toBe(false);
  });

  it("溢出时页数仍等于上限：不再多排一页（2026-10-21 截断）", () => {
    // 1 页上限 + 溢出 → 仍然只画 1 页，内容被裁。
    const single = geometry(1, { overflow: true });
    expect(single.totalVisualPages).toBe(1);
    expect(single.overflowClipped).toBe(true);

    // 2 页上限 + 溢出 → 仍然只画 2 页，不再冒出第 3 页。
    const double = geometry(2, { overflow: true });
    expect(double.totalVisualPages).toBe(2);
    expect(double.overflowClipped).toBe(true);
  });
});
