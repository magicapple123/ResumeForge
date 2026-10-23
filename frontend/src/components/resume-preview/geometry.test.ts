// SPDX-License-Identifier: Apache-2.0
/**
 * 预览几何：**多页竖向堆叠**（2026-10-21 起，取代横向并排），
 * 唯一的例外是 **1 页上限**——那时不因溢出而多排一列，超出部分直接裁掉。
 *
 * 2026-10-23 追加「可读下限 / 大屏上限」两组：`MIN_READABLE_SCALE = 0.55` 之后
 * 缩放下限是硬约束（rubric R7：纸面 ≥ 437px），而 `maxFitScale` 只在大屏生效。
 */
import { describe, expect, it } from "vitest";
import { A4_HEIGHT_PX, A4_WIDTH_PX, MIN_READABLE_SCALE, PAGE_STACK_GAP_PX } from "./config";
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

/** 只关心"容器宽 × 高"时的几何：单页、无溢出。 */
function fitIn(width: number, height: number, extra: { zoom?: number; maxFitScale?: number } = {}) {
  return calculatePreviewGeometry({
    availableSpace: { width, height },
    paperHeight: A4_HEIGHT_PX,
    pageCount: 1,
    zoom: extra.zoom ?? 1,
    overflow: false,
    naturalWidth: A4_WIDTH_PX,
    pageGap: 0,
    measure: null,
    maxFitScale: extra.maxFitScale,
  });
}

describe("A4 可读下限（2026-10-23）", () => {
  it("容器矮到只允许 0.34 时不再缩小：scale 停在 0.55，纸面宽 437", () => {
    // 1092×614 实测：画布 672×382 —— 按旧算法这里会缩到 0.339（正文 4.7px）。
    const result = fitIn(672, 382);
    expect(result.clampedToMin).toBe(true);
    expect(result.scale).toBe(MIN_READABLE_SCALE);
    expect(Math.round(A4_WIDTH_PX * result.scale)).toBe(437);
  });

  it("1366 的窄画布（458×476）同样触底，且纸比容器高（要纵向滚动）", () => {
    const result = fitIn(458, 476);
    expect(result.clampedToMin).toBe(true);
    expect(result.scale).toBeCloseTo(0.55, 5);
    expect(result.scaledHeight).toBeGreaterThan(476);
  });

  it("放得下时不触底：2048 画布（1140×796）由高度决定，纸面 563", () => {
    const result = fitIn(1140, 796);
    expect(result.clampedToMin).toBe(false);
    expect(result.scale).toBeCloseTo(796 / A4_HEIGHT_PX, 3);
    expect(Math.round(A4_WIDTH_PX * result.scale)).toBe(563);
  });

  it("手动缩小也不许低于下限（MIN_ZOOM 0.5 仍被抬到 0.55）", () => {
    const result = fitIn(1400, 1200, { zoom: 0.5 });
    // fit = min(1400/794, 1200/1123) = 1.068 → ×0.5 = 0.534 → 抬到 0.55
    expect(result.scale).toBe(MIN_READABLE_SCALE);
  });
});

describe("大屏放大上限 maxFitScale", () => {
  it("默认 1：保持「永不放大」，2560 屏的纸仍是 794", () => {
    const result = fitIn(1740, 1276);
    expect(result.scale).toBe(1);
    expect(Math.round(A4_WIDTH_PX * result.scale)).toBe(794);
  });

  it("1.35：同一容器由高度封顶 1.136，纸面 902", () => {
    const result = fitIn(1740, 1276, { maxFitScale: 1.35 });
    expect(result.scale).toBeCloseTo(1276 / A4_HEIGHT_PX, 3);
    expect(Math.round(A4_WIDTH_PX * result.scale)).toBe(902);
  });

  it("1.35 在 1280 高的屏上不生效（高度先封顶，纸仍是 789）", () => {
    const result = fitIn(1228, 1116, { maxFitScale: 1.35 });
    expect(result.scale).toBeCloseTo(1116 / A4_HEIGHT_PX, 3);
    expect(Math.round(A4_WIDTH_PX * result.scale)).toBe(789);
  });
});

describe("单调性：纸面宽对容器宽、高都不下降", () => {
  it("宽 480→2560（每 8px）与高 560→1440（每 8px）分别扫一遍", () => {
    const paperWidth = (w: number, h: number) => Math.round(A4_WIDTH_PX * fitIn(w, h).scale);

    let previous = 0;
    for (let width = 480; width <= 2560; width += 8) {
      const paper = paperWidth(width, 900);
      expect(paper).toBeGreaterThanOrEqual(previous - 1);
      previous = paper;
    }

    previous = 0;
    for (let height = 560; height <= 1440; height += 8) {
      const paper = paperWidth(1200, height);
      expect(paper).toBeGreaterThanOrEqual(previous - 1);
      previous = paper;
    }
  });

  it("任何容器下 scale 都不低于 0.55", () => {
    for (const width of [320, 480, 768, 1092, 1366, 1920, 2560]) {
      for (const height of [400, 560, 614, 768, 1080, 1440]) {
        expect(fitIn(width, height).scale).toBeGreaterThanOrEqual(MIN_READABLE_SCALE);
      }
    }
  });
});
