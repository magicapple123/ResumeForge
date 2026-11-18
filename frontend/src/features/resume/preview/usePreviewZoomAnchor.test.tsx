// SPDX-License-Identifier: Apache-2.0
/**
 * I-40：缩放锚点的"吃什么量什么"接线。
 *
 * 几何算法在 `zoomAnchor.test.ts` 里已覆盖；这里守的是**接线**：
 * - 内容框 / 横向滚动容器 / 纵向滚动容器 / 比例全部取自宿主给的 getter（精确模式才有解）；
 * - 比例用现量值（`scale()`）而不是渲染期入参；
 * - 草稿模式的 iframe 坐标换算不回归。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePreviewZoomAnchor } from "./usePreviewZoomAnchor";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function fakeEl(box: Box) {
  const el = {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 400,
    clientHeight: 300,
    scrollWidth: 1600,
    scrollHeight: 2000,
    getBoundingClientRect: () =>
      ({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => undefined,
      }) as DOMRect,
  };
  return el as unknown as HTMLElement & { scrollLeft: number; scrollTop: number };
}

function wheelAt(clientX: number, clientY: number, frame?: HTMLElement) {
  return {
    clientX,
    clientY,
    view: frame ? ({ frameElement: frame } as unknown as Window) : null,
  } as unknown as WheelEvent;
}

describe("usePreviewZoomAnchor（I-40 精确模式）", () => {
  it("精确模式：按宿主给的内容框与滚动容器补偿（无 .resume-preview-scale-box 也能生效）", () => {
    const content = fakeEl({ left: 100, top: 50, width: 794, height: 1123 });
    const horizontal = fakeEl({ left: 0, top: 0, width: 400, height: 300 });
    const vertical = fakeEl({ left: 0, top: 0, width: 400, height: 300 });
    let scale = 1;
    const props = {
      contentEl: () => content,
      hScroller: () => horizontal,
      vScroller: () => vertical,
      scale: () => scale,
    };
    const { result, rerender } = renderHook(
      (scaleValue: number) => usePreviewZoomAnchor({ ...props, scaleValue }),
      { initialProps: 1 },
    );

    result.current(wheelAt(300, 200));
    // 放大到 200%：纸面内容框跟着变宽（模拟 `.exact-preview-paper-column` 的 width）。
    scale = 2;
    content.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 1588,
        height: 2246,
        right: 1688,
        bottom: 2296,
        x: 100,
        y: 50,
        toJSON: () => undefined,
      }) as DOMRect;
    rerender(2);

    // contentX = (300-100)/1 = 200 → 补偿 = 100 + 200*2 - 300 = 200
    expect(horizontal.scrollLeft).toBe(200);
    // contentY = (200-50)/1 = 150 → 补偿 = 50 + 150*2 - 200 = 150
    expect(vertical.scrollTop).toBe(150);
  });

  it("比例没变（到缩放上限）不补偿：不拿陈旧锚点改滚动位置", () => {
    const content = fakeEl({ left: 0, top: 0, width: 794, height: 1123 });
    const horizontal = fakeEl({ left: 0, top: 0, width: 400, height: 300 });
    const props = {
      contentEl: () => content,
      hScroller: () => horizontal,
      vScroller: () => horizontal,
      scale: () => 1,
    };
    const { result, rerender } = renderHook(
      (scaleValue: number) => usePreviewZoomAnchor({ ...props, scaleValue }),
      { initialProps: 1 },
    );
    result.current(wheelAt(10, 10));
    rerender(2); // 状态想变，但纸面比例仍是 1（被夹住）
    expect(horizontal.scrollLeft).toBe(0);
  });

  it("草稿回归：iframe 内的光标坐标按比例换算到父页面", () => {
    const content = fakeEl({ left: 100, top: 50, width: 794, height: 1123 });
    const frame = fakeEl({ left: 100, top: 50, width: 794, height: 1123 });
    const horizontal = fakeEl({ left: 0, top: 0, width: 400, height: 300 });
    let scale = 1;
    const props = {
      contentEl: () => content,
      hScroller: () => horizontal,
      vScroller: () => horizontal,
      scale: () => scale,
    };
    const { result, rerender } = renderHook(
      (scaleValue: number) => usePreviewZoomAnchor({ ...props, scaleValue }),
      { initialProps: 1 },
    );
    // iframe 里的 (100, 100) 在 scale=1 时对应父页面 (200, 150)。
    result.current(wheelAt(100, 100, frame));
    scale = 2;
    rerender(2);
    // contentX = 100 → 补偿 = 100 + 100*2 - 200 = 100
    expect(horizontal.scrollLeft).toBe(100);
  });
});
