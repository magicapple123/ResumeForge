// SPDX-License-Identifier: Apache-2.0
/** 刷新预览时的显示比例补偿：纯函数边界 + 换文档后 fit 变化时的补偿时序。 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "../../components/resume-preview/config";
import { stableZoom, useStablePreviewScale } from "./useStablePreviewScale";

describe("stableZoom", () => {
  it("fit 变小（头部多了提示条）时把缩放补回去，纸面显示比例不变", () => {
    expect(stableZoom(0.804, 0.59, 1.2)).toBeCloseTo(0.804 / 0.59, 6);
  });

  it("没有历史或比例一致时不返回新值", () => {
    expect(stableZoom(null, 0.59, 1.2)).toBeNull();
    expect(stableZoom(0.708, 0.59, 1.2)).toBeNull();
    expect(stableZoom(0.7, 0, 1)).toBeNull();
  });

  it("补偿值夹在缩放上下限内", () => {
    expect(stableZoom(0.85, 0.2, 1.2)).toBe(MAX_ZOOM);
    expect(stableZoom(0.1, 1, 1.2)).toBe(MIN_ZOOM);
  });

  it("用户没缩放（zoom = 1 = 适应页面）时不做补偿：fit 变了就让纸变大/变小（Q21）", () => {
    // 右栏实测宽度变化会让 fit 从占位值降到真实比例；钉住 100% 会让默认档横向溢出。
    expect(stableZoom(1, 0.62, 1)).toBeNull();
    expect(stableZoom(0.85, 0.59, 1)).toBeNull();
  });
});

describe("useStablePreviewScale", () => {
  it("换文档后的 fit 变化把缩放补回，显示比例保持", () => {
    const setZoom = vi.fn();
    const { rerender } = renderHook(
      (props: { token: string; display: number; fit: number; zoom: number }) =>
        useStablePreviewScale(props.token, props.display, props.fit, props.zoom, setZoom),
      { initialProps: { token: "a", display: 0.81, fit: 0.67, zoom: 1.2 } },
    );
    // 换文档的那一帧：fit 还没变，只记快照（显示比例仍是 81%）。
    rerender({ token: "b", display: 0.81, fit: 0.67, zoom: 1.2 });
    expect(setZoom).not.toHaveBeenCalled();
    // 头部提示条出现：fit 67% → 59%，按比值把缩放补到 1.37，显示仍是 81%。
    rerender({ token: "b", display: 0.71, fit: 0.59, zoom: 1.2 });
    expect(setZoom).toHaveBeenCalledWith(expect.closeTo(0.81 / 0.59, 6));
  });
});
