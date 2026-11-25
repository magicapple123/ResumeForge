// SPDX-License-Identifier: Apache-2.0
/**
 * CR-15：设置页切组时的"跳动"。
 *
 * 现象：内容区已经滚到很下面时切组，整页被强行拉回顶部（看起来像闪了一下）；
 * 只滚了几十像素时切组也会被拉回顶部，反而把用户刚看的位置顶走。
 *
 * 口径：只有"内容顶已经滚出视口"才回顶——0/50 不动，600 回 78（= 内容顶 94px
 * 退掉 16px 的滚动余量）。这里钉住判定与落点两个数，别让未来的"顺手改成
 * scrollIntoView"又把 0/50 那两种情况带回来。
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_SCROLL_MARGIN, scrollSettingsToTop, shouldResetScroll } from "./settingsFocus";

/** 造一个可控的"滚动容器 + 内容区"：rect 用桩函数给出，scrollTop 可写。 */
function makeScroller(scrollTop: number, bodyTop: number, margin = SETTINGS_SCROLL_MARGIN) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollTop", { value: scrollTop, writable: true });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;

  const body = document.createElement("div");
  body.getBoundingClientRect = () => ({ top: bodyTop - scrollTop }) as DOMRect;
  scroller.appendChild(body);
  document.body.appendChild(scroller);
  return { scroller, body, margin };
}

describe("shouldResetScroll", () => {
  it("keeps the position when the content top is still in view", () => {
    // 内容顶 94px、滚动余量 16px：滚了 0 / 50 都还在视口内，不该动。
    expect(shouldResetScroll(0, 94, 16)).toBe(false);
    expect(shouldResetScroll(50, 94, 16)).toBe(false);
  });

  it("resets once the content top has scrolled out of the viewport", () => {
    expect(shouldResetScroll(600, 94, 16)).toBe(true);
    // 边界：刚好越过"内容顶 - 余量"就该回顶。
    expect(shouldResetScroll(79, 94, 16)).toBe(true);
    expect(shouldResetScroll(78, 94, 16)).toBe(false);
  });

  it("treats a zero scroll offset as 'already at the top' even with a negative bodyTop", () => {
    expect(shouldResetScroll(0, 0, 16)).toBe(false);
    expect(shouldResetScroll(-10, 0, 16)).toBe(false);
  });
});

describe("scrollSettingsToTop", () => {
  it("moves the scroller to bodyTop - margin", () => {
    const { scroller, body } = makeScroller(600, 94);
    expect(scrollSettingsToTop(body)).toBe(true);
    expect(scroller.scrollTop).toBe(78);
  });

  it("does not move when the content top is still visible", () => {
    for (const offset of [0, 50]) {
      const { scroller, body } = makeScroller(offset, 94);
      expect(scrollSettingsToTop(body)).toBe(false);
      expect(scroller.scrollTop).toBe(offset);
    }
  });

  it("does nothing when the node is already gone", () => {
    expect(scrollSettingsToTop(null)).toBe(false);
  });
});
