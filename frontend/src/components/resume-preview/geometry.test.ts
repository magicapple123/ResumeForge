// SPDX-License-Identifier: Apache-2.0
/**
 * 预览几何：**多页横向并排**（用户 2026-10-20 选定的形态），
 * 唯一的例外是 **1 页上限**——那时不因溢出而多排一列，超出部分直接裁掉。
 */
import { describe, expect, it } from "vitest";
import { A4_HEIGHT_PX, A4_WIDTH_PX, EXPAND_OVERFLOW_ON_SINGLE_PAGE } from "./config";
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

describe("预览几何：多页横向并排", () => {
  it("2 / 3 页并排：宽度 = 页数 × A4，高度仍是一页", () => {
    for (const pages of [2, 3]) {
      const result = geometry(pages);
      expect(result.contentTotalWidth).toBe(A4_WIDTH_PX * pages);
      expect(result.contentTotalHeight).toBe(A4_HEIGHT_PX);
      expect(result.totalVisualPages).toBe(pages);
      expect(result.separatorCount).toBe(pages - 1);
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

  it("「1 页时是否向右展开」是一个显式开关，默认关闭", () => {
    // 改这个值等于恢复"溢出时另起一列"的老行为，必须是有意为之。
    expect(EXPAND_OVERFLOW_ON_SINGLE_PAGE).toBe(false);
  });
});
