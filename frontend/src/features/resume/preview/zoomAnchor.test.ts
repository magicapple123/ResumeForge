// SPDX-License-Identifier: Apache-2.0
/** QW-7：光标锚点的纯几何。 */
import { describe, expect, it } from "vitest";
import { clampPointerToBox, clampScroll, contentPoint, scrollDeltaFor } from "./zoomAnchor";

const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe("QW-7 · 缩放锚点", () => {
  it("缩放后光标下的内容点回到同一屏幕位置（偏差 < 0.001px）", () => {
    const pointer = { x: 300, y: 250 };
    const oldBox = { x: 100, y: 50 };
    const content = contentPoint(pointer, oldBox, 1);
    expect(content).toEqual({ x: 200, y: 200 });

    const nextBox = { x: 100, y: 50 };
    const delta = scrollDeltaFor(content, 2, nextBox, pointer);
    // 纸长到两倍后，同一内容点跑到 100+400=500，需要把滚动条往右推 200。
    expect(delta).toEqual({ x: 200, y: 200 });
    // 补偿之后的屏幕位置 = 新盒子起点 + 内容偏移 − 滚动补偿 = 光标位置。
    expect(nextBox.x + content.x * 2 - delta.x).toBe(pointer.x);
    expect(nextBox.y + content.y * 2 - delta.y).toBe(pointer.y);
  });

  it("纸张居中位置变化时一并计入（margin: 0 auto）", () => {
    const pointer = { x: 300, y: 200 };
    const content = contentPoint(pointer, { x: 150, y: 20 }, 1); // x:150 y:180
    // 放大后纸比相框宽，盒左缘从 150 回到 0（不再居中）。
    const delta = scrollDeltaFor(content, 2, { x: 0, y: 20 }, pointer);
    // 盒左缘从 150 移到 0，正好抵消放大带来的 +300：光标不用滚。
    expect(delta.x).toBe(0 + 150 * 2 - 300);
    expect(delta.y).toBe(20 + 180 * 2 - 200);
  });

  it("内容比视口小时不补偿（避免负滚动 / 漂移）", () => {
    expect(clampScroll(-80, 500, 300)).toBe(0);
    expect(clampScroll(120, 500, 300)).toBe(0);
    expect(clampScroll(120, 500, 900)).toBe(120);
    expect(clampScroll(9999, 500, 900)).toBe(400);
  });

  it("光标落在纸面留白时夹进纸面矩形", () => {
    const rect = box(100, 50, 794, 1123);
    expect(clampPointerToBox({ x: 20, y: 30 }, rect)).toEqual({ x: 100, y: 50 });
    expect(clampPointerToBox({ x: 2000, y: 2000 }, rect)).toEqual({ x: 894, y: 1173 });
    expect(clampPointerToBox({ x: 300, y: 400 }, rect)).toEqual({ x: 300, y: 400 });
  });

  it("比例非法时退回原点，不产生 NaN 滚动", () => {
    expect(contentPoint({ x: 10, y: 10 }, { x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
    expect(clampScroll(Number.NaN, 500, 900)).toBe(0);
  });
});
