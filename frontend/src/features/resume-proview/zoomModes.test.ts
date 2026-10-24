// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  clampZoomFactor,
  resolveZoomMode,
  scaleForMode,
  zoomFactorForMode,
  zoomPercent,
} from "./zoomModes";

const GEOMETRY = { fitScale: 0.8, viewportWidth: 800, pageWidth: 794 };

describe("缩放档位（D04）", () => {
  it("整页 = fit；适宽 = 视口宽/页宽；100% = 1", () => {
    expect(scaleForMode("page", GEOMETRY)).toBeCloseTo(0.8, 6);
    expect(scaleForMode("width", GEOMETRY)).toBeCloseTo(800 / 794, 6);
    expect(scaleForMode("actual", GEOMETRY)).toBe(1);
  });

  it("档位换成 zoom 系数：当前 fit 缩放下 1 表示整页", () => {
    expect(zoomFactorForMode("page", GEOMETRY)).toBeCloseTo(1, 6);
    expect(zoomFactorForMode("width", GEOMETRY)).toBeCloseTo(800 / 794 / 0.8, 6);
    expect(zoomFactorForMode("actual", GEOMETRY)).toBeCloseTo(1 / 0.8, 6);
  });

  it("fitScale 为 0（首帧未量到）时按 1 兜底，不产生 Infinity", () => {
    const degenerate = { fitScale: 0, viewportWidth: 0, pageWidth: 794 };
    expect(zoomFactorForMode("actual", degenerate)).toBe(1);
    expect(Number.isFinite(zoomFactorForMode("width", degenerate))).toBe(true);
  });

  it("反推档位命中容差内命中，手动缩放到中间值返回 null", () => {
    expect(resolveZoomMode(0.8, GEOMETRY)).toBe("page");
    expect(resolveZoomMode(800 / 794, GEOMETRY)).toBe("width");
    expect(resolveZoomMode(1, GEOMETRY)).toBe("actual");
    expect(resolveZoomMode(1.23, GEOMETRY)).toBeNull();
  });

  it("手动缩放系数有上限，NaN 回落到 1", () => {
    expect(clampZoomFactor(Number.NaN)).toBe(1);
    expect(clampZoomFactor(1000)).toBe(6);
    expect(clampZoomFactor(0.0001)).toBe(0.3);
  });

  it("百分比读数四舍五入", () => {
    expect(zoomPercent(0.8)).toBe(80);
    expect(zoomPercent(0.856)).toBe(86);
  });
});
