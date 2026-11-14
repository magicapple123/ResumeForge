// SPDX-License-Identifier: Apache-2.0
/**
 * 列间距的换算与上限（任务 10）。
 *
 * `gap` 的单位是**字号倍数**（后端 `column-gap: calc(var(--fs) * gap)`），不是像素：
 * 面板要显示「8.00 倍字宽 ≈ 112px」就必须做这一次换算，而换算写错（拿 4 当上限、
 * 或者直接当 px 用）在界面上只表现为"数字不对"，很难靠肉眼发现。
 *
 * 这里只测纯函数 `gapGeometry`：DOM 读尺子（`.resume-wb-canvas iframe` 的 `--fs` 与内容宽）
 * 那两段在 jsdom 里没有意义，读不到时函数返回 null 的降级行为才是要钉住的。
 */
import { describe, expect, it } from "vitest";
import {
  columnWidthSum,
  equalWidths,
  gapGeometry,
  initialGaps,
  millimetersToRatio,
  moveColumnDivider,
  normalizeColumnWidths,
  ratioToMillimeters,
  snapColumnWidths,
} from "./entryColumnGeometry";

describe("逐列宽度 / 逐间隔的草稿口径（任务 13）", () => {
  it("等分宽度合计正好 100（3 列 34/33/33、2 列 50/50）", () => {
    expect(equalWidths(3)).toEqual([34, 33, 33]);
    expect(equalWidths(2)).toEqual([50, 50]);
    expect(columnWidthSum(equalWidths(3))).toBe(100);
  });

  it("逐间隔初值按统一 gap 铺满 N−1 个，缺省 1.2", () => {
    expect(initialGaps(3, 2)).toEqual([2, 2]);
    expect(initialGaps(2, null)).toEqual([1.2]);
    expect(initialGaps(1, 2)).toEqual([]);
  });

  it("合计 99.5 与 100.5 都在容差内（前端 0.5 与后端一致）", () => {
    expect(Math.abs(columnWidthSum([33, 33, 33.5]) - 100)).toBeLessThanOrEqual(0.5);
    // 33/33/33 合计 99，差 1 → 超出 0.5 容差，应用按钮必须禁用
    expect(Math.abs(columnWidthSum([33, 33, 33]) - 100)).toBeGreaterThan(0.5);
  });

  it("只在归一化时处理宽度总和，保留每列至少 10%", () => {
    const normalized = normalizeColumnWidths([33, 33, 33]);
    expect(normalized.reduce((sum, width) => sum + width, 0)).toBe(100);
    expect(normalized).toEqual([33.34, 33.33, 33.33]);
    expect(normalizeColumnWidths([90, 10, 10])).toEqual([80, 10, 10]);
  });

  it("分栏边界移动只调整相邻两列并守住 10% 下限", () => {
    expect(moveColumnDivider([50, 50], 0, 20)).toEqual([70, 30]);
    expect(moveColumnDivider([70, 30], 0, 50)).toEqual([90, 10]);
    expect(moveColumnDivider([34, 33, 33], 0, 10)).toEqual([44, 23, 33]);
    expect(moveColumnDivider([50, 50], 2, 1)).toEqual([50, 50]);
  });

  it("吸附等宽与两列 65:35 / 35:65 预设", () => {
    expect(snapColumnWidths([50.5, 49.5])).toEqual([50, 50]);
    expect(snapColumnWidths([64.5, 35.5])).toEqual([65, 35]);
    expect(snapColumnWidths([34, 33, 33])).toEqual([34, 33, 33]);
    expect(snapColumnWidths([70, 30])).toEqual([70, 30]);
  });

  it("毫米与字号倍数按真实基准字号双向换算", () => {
    expect(ratioToMillimeters(1.5, 14)).toBeCloseTo(5.5566, 4);
    expect(millimetersToRatio(5.5566, 14)).toBeCloseTo(1.5, 4);
    expect(ratioToMillimeters(1.5, null)).toBeNull();
    expect(millimetersToRatio(1.5, 0)).toBeNull();
  });
});

describe("gapGeometry（任务 10）", () => {
  it("把字号倍数换算成像素（8 倍 × 14px = 112px）", () => {
    expect(gapGeometry(1, 8, 14, 680).gapPx).toBe(112);
    expect(gapGeometry(1, 4, 14, 680).gapPx).toBe(56);
  });

  it("每列宽度扣掉全部间隔后再平分", () => {
    // 三列、两个间隔 × 112px：680 - 224 = 456 → 每列 152
    expect(gapGeometry(3, 8, 14, 680).columnPx).toBe(152);
    expect(gapGeometry(1, 0, 14, 680).columnPx).toBe(680);
  });

  it("三列且每列 < 60px 时给出提示信号", () => {
    // 内容宽 300、两个间隔 2×112：300 - 224 = 76 → 每列 25.3px
    expect(gapGeometry(3, 8, 14, 300).tooNarrow).toBe(true);
    // 两列时同样的内容宽不触发（提示只针对"三列挤成一字一行"）
    expect(gapGeometry(2, 8, 14, 300).tooNarrow).toBe(false);
    // A4 正常内容宽下不会触发（触发它需要真正极端的组合）
    expect(gapGeometry(3, 8, 14, 680).tooNarrow).toBe(false);
  });

  it("读不到字号基准 / 内容宽时返回 null，绝不猜一个数字", () => {
    expect(gapGeometry(3, 4, null, 680).gapPx).toBeNull();
    expect(gapGeometry(3, 4, null, 680).columnPx).toBeNull();
    expect(gapGeometry(3, 4, 14, null).columnPx).toBeNull();
    expect(gapGeometry(3, 4, 14, null).tooNarrow).toBe(false);
  });

  it("gap 为空（继承）时按 0 算每列宽，换算那一行也不显示", () => {
    expect(gapGeometry(2, null, 14, 400).gapPx).toBeNull();
    expect(gapGeometry(2, null, 14, 400).columnPx).toBe(200);
  });
});
