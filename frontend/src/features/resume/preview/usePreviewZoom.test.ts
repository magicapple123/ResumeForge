// SPDX-License-Identifier: Apache-2.0
/** QW-7：滚轮连续缩放 / 可见百分比步进 / deltaMode 归一。 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "./config";
import {
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_PAGE_HEIGHT_PX,
  nextWheelZoom,
  usePreviewZoom,
  wheelPixels,
} from "./usePreviewZoom";

const wheel = (deltaY: number, extra: Partial<{ deltaX: number; deltaMode: number }> = {}) => ({
  ctrlKey: true,
  metaKey: false,
  deltaY,
  ...extra,
});

describe("QW-7 · 滚轮连续缩放", () => {
  it("deltaMode 归一：像素 / 行 / 页三种单位换算到同一量级", () => {
    expect(wheelPixels(wheel(100))).toBe(100);
    expect(wheelPixels(wheel(3, { deltaMode: 1 }))).toBe(3 * WHEEL_LINE_HEIGHT_PX);
    expect(wheelPixels(wheel(1, { deltaMode: 2 }))).toBe(WHEEL_PAGE_HEIGHT_PX);
  });

  it("deltaY 越小，步长越小（不是固定 10%）", () => {
    const small = nextWheelZoom(1, wheel(-20)) - 1;
    const large = nextWheelZoom(1, wheel(-120)) - 1;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(large);
    // 20px 的一格约 3%，而不是旧实现的 10%。
    expect(small).toBeCloseTo(Math.exp(20 * 0.0015) - 1, 6);
  });

  it("快速滚动到边界后停住，不越界也不弹回", () => {
    expect(nextWheelZoom(1, wheel(-100000))).toBe(MAX_ZOOM);
    expect(nextWheelZoom(1, wheel(100000))).toBe(MIN_ZOOM);
    expect(nextWheelZoom(MAX_ZOOM, wheel(-100))).toBe(MAX_ZOOM);
  });

  it("横向分量占优的触控板滑动不缩放", () => {
    const { result } = renderHook(() => usePreviewZoom());
    let consumed = false;
    act(() => {
      consumed = result.current.zoomByWheel(wheel(-10, { deltaX: -80 }));
    });
    expect(consumed).toBe(false);
    expect(result.current.zoom).toBe(1);
  });

  it("滚轮消费事件（调用方要继续 preventDefault），无 Ctrl 不消费", () => {
    const { result } = renderHook(() => usePreviewZoom());
    let consumed = true;
    act(() => {
      consumed = result.current.zoomByWheel(wheel(-30));
    });
    expect(consumed).toBe(true);
    expect(result.current.zoom).toBeGreaterThan(1);

    let plain = true;
    act(() => {
      plain = result.current.zoomByWheel({ ctrlKey: false, metaKey: false, deltaY: -30 });
    });
    expect(plain).toBe(false);
  });
});

describe("QW-7 · 按钮按可见百分比步进", () => {
  it("放大 5% / 缩小 5% 是系数比，不是系数加 0.05", () => {
    const { result } = renderHook(() => usePreviewZoom(1.2));
    act(() => result.current.zoomByFactor(1.05));
    expect(result.current.zoom).toBeCloseTo(1.26, 6);
    act(() => result.current.zoomByFactor(1 / 1.05));
    expect(result.current.zoom).toBeCloseTo(1.2, 6);
    // 反证：可见百分比 = 系数 × fitScale，所以系数比就是屏幕上的比例比。
    expect(result.current.zoom / 1.2).toBeCloseTo(1, 6);
  });

  it("非法系数不改变状态", () => {
    const { result } = renderHook(() => usePreviewZoom());
    act(() => result.current.zoomByFactor(0));
    act(() => result.current.zoomByFactor(Number.NaN));
    expect(result.current.zoom).toBe(1);
  });
});
