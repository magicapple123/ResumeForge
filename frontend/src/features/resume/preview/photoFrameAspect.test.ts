// SPDX-License-Identifier: Apache-2.0
/**
 * I-37：画框比例 → 裁剪默认预设 / 提示标签（纯函数）。
 *
 * 数值取自后端模板的真实画框声明（`backend/app/templates/*.j2` 的 `.profile-photo`
 * 宽高比），不是手写的近似值——默认模板实测 DOM 为 77.609375 / 98.546875。
 */
import { describe, expect, it } from "vitest";
import { frameRatioLabel, nearestCropAspect } from "./photoFrameAspect";

/** 各模板 `.profile-photo` 的 width / height（读自模板 CSS）。 */
const TEMPLATE_FRAME_RATIOS = {
  classic: 6.3 / 8,
  compact: 5.4 / 7,
  minimal: 5.4 / 7,
  elegant: 5.6 / 7.2,
  technical: 5.8 / 7.4,
  split: 5.8 / 7.4,
  modern: 6.6 / 6.6,
  editorial: 6.2 / 6.2,
  scholar: 5 / 5,
};

describe("I-37 裁剪默认比例", () => {
  it("默认模板（6.3:8 = 0.7875）选 4:5，而不是把 4:5 写死给所有模板", () => {
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.classic)).toBe("4:5");
  });

  it("正方形画框（modern / editorial / scholar）选 1:1", () => {
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.modern)).toBe("1:1");
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.editorial)).toBe("1:1");
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.scholar)).toBe("1:1");
  });

  it("更窄的画框（compact / minimal 5.4:7 = 0.7714）选 3:4", () => {
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.compact)).toBe("3:4");
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.minimal)).toBe("3:4");
  });

  it("elegant / technical / split：绝对差最小的一档", () => {
    // 0.7778 与 4:5 差 0.0222、与 3:4 差 0.0278 → 4:5
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.elegant)).toBe("4:5");
    // 0.7838 与 4:5 差 0.0162、与 3:4 差 0.0338 → 4:5
    expect(nearestCropAspect(TEMPLATE_FRAME_RATIOS.technical)).toBe("4:5");
  });

  it("量不到画框（iframe 未挂 / 尺寸为 0）时返回 null：调用方保持「原图」，不瞎猜", () => {
    expect(nearestCropAspect(undefined)).toBeNull();
    expect(nearestCropAspect(null)).toBeNull();
    expect(nearestCropAspect(0)).toBeNull();
    expect(nearestCropAspect(Number.NaN)).toBeNull();
    expect(nearestCropAspect(-1)).toBeNull();
  });
});

describe("I-37 画框比例标签", () => {
  it("默认模板实测 0.7875376… 写成 6.3:8（不是四舍五入成 3:4）", () => {
    expect(frameRatioLabel(0.7875376565720628)).toBe("6.3:8");
  });

  it("1:1 与横框各有稳定写法", () => {
    expect(frameRatioLabel(1)).toBe("1:1");
    expect(frameRatioLabel(4 / 3)).toBe("8:6");
    expect(frameRatioLabel(5.6 / 7.2)).toBe("6.2:8");
  });

  it("非法比例返回空串（提示整句不渲染）", () => {
    expect(frameRatioLabel(undefined)).toBe("");
    expect(frameRatioLabel(0)).toBe("");
    expect(frameRatioLabel(Number.POSITIVE_INFINITY)).toBe("");
  });
});
