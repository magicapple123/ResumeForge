// SPDX-License-Identifier: Apache-2.0
/**
 * 右键菜单落位：四个角都不能越出视口（问题 25 验收「四角右键都不出视口」）。
 *
 * 纯函数 + 显式视口，不依赖浏览器布局：jsdom 量不到盒子，所以"是否越界"只能在这里
 * 用几何算，而不是去断言 antd 的实际坐标。
 */
import { describe, expect, it } from "vitest";
import { MENU_GAP, VIEWPORT_MARGIN, placeMenu } from "./positioning";

const VIEWPORT = { width: 1280, height: 800 };
const SIZE = { width: 180, height: 240 };

describe("placeMenu", () => {
  it("常规位置：落在指针右下方 MENU_GAP 处", () => {
    expect(placeMenu({ x: 400, y: 300 }, SIZE, { viewport: VIEWPORT })).toEqual({
      left: 400 + MENU_GAP,
      top: 300 + MENU_GAP,
    });
  });

  it("右下角：横向夹进视口，纵向翻到指针上方（不越出下边）", () => {
    const { left, top } = placeMenu({ x: 1270, y: 790 }, SIZE, { viewport: VIEWPORT });
    expect(left).toBe(VIEWPORT.width - SIZE.width - VIEWPORT_MARGIN);
    expect(top).toBe(790 - SIZE.height - MENU_GAP);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(top + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("左下角：贴左边距，纵向翻上", () => {
    const { left, top } = placeMenu({ x: 2, y: 780 }, SIZE, { viewport: VIEWPORT });
    expect(left).toBe(VIEWPORT_MARGIN);
    expect(top + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("右上角：横向夹进视口，纵向正常向下", () => {
    const { left, top } = placeMenu({ x: 1279, y: 4 }, SIZE, { viewport: VIEWPORT });
    expect(left + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it("左上角：两边都贴边距", () => {
    expect(placeMenu({ x: 0, y: 0 }, SIZE, { viewport: VIEWPORT })).toEqual({
      left: VIEWPORT_MARGIN,
      top: VIEWPORT_MARGIN,
    });
  });

  it("视口比菜单还矮：贴顶显示，起点仍可见", () => {
    const { top } = placeMenu(
      { x: 10, y: 10 },
      { width: 180, height: 900 },
      {
        viewport: VIEWPORT,
      },
    );
    expect(top).toBe(VIEWPORT_MARGIN);
  });
});
