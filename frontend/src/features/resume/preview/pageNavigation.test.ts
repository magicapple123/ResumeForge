// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  clampPage,
  findScrollableAncestor,
  measureVisiblePage,
  pageScrollTop,
  resolveVisiblePage,
  stepPage,
} from "./pageNavigation";

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function scrollable(height: number, clientHeight: number): HTMLElement {
  const node = document.createElement("div");
  node.style.overflowY = "auto";
  Object.defineProperty(node, "scrollHeight", { value: height, configurable: true });
  Object.defineProperty(node, "clientHeight", { value: clientHeight, configurable: true });
  return node;
}

describe("页导航几何（D04）", () => {
  it("视口中线落在哪一页就是当前页", () => {
    const pages = [
      { top: 0, height: 1000 },
      { top: 1024, height: 1000 },
      { top: 2048, height: 1000 },
    ];
    expect(resolveVisiblePage(pages, 800)).toBe(1);
    expect(resolveVisiblePage(pages, 2400)).toBe(2);
    expect(resolveVisiblePage(pages, 6000)).toBe(3);
  });

  it("页间空白时取距离最近的一页；无页面时回 1", () => {
    const pages = [
      { top: 0, height: 100 },
      { top: 500, height: 100 },
    ];
    // 视口中线 320：离第一页 170、离第二页 130 → 第二页
    expect(resolveVisiblePage(pages, 640)).toBe(2);
    expect(resolveVisiblePage([], 640)).toBe(1);
  });

  it("页码夹取与步进在两端停住", () => {
    expect(clampPage(0, 2)).toBe(1);
    expect(clampPage(9, 2)).toBe(2);
    expect(stepPage(1, 2, -1)).toBe(1);
    expect(stepPage(2, 2, 1)).toBe(2);
    expect(stepPage(1, 3, 1)).toBe(2);
  });

  it("翻页的 scrollTop = 当前 + 页相对容器顶（不依赖 offsetTop 的缩放差）", () => {
    expect(pageScrollTop(1200, 300)).toBe(1500);
    expect(pageScrollTop(-50, 10)).toBe(0);
  });

  it("向上找到真正滚动的祖先（制作台是外层画布）", () => {
    const scroller = scrollable(2000, 800);
    const inner = document.createElement("div");
    scroller.appendChild(inner);
    document.body.appendChild(scroller);
    expect(findScrollableAncestor(inner)).toBe(scroller);
    scroller.remove();
  });

  it("量当前页：rect 相对滚动容器换算", () => {
    const scroller = scrollable(3000, 800);
    Object.defineProperty(scroller, "getBoundingClientRect", {
      value: () => rect(100, 800),
      configurable: true,
    });
    const container = document.createElement("div");
    const first = document.createElement("div");
    first.className = "resume-preview-page";
    Object.defineProperty(first, "getBoundingClientRect", {
      value: () => rect(100, 1100),
      configurable: true,
    });
    const second = document.createElement("div");
    second.className = "resume-preview-page";
    Object.defineProperty(second, "getBoundingClientRect", {
      value: () => rect(1240, 1100),
      configurable: true,
    });
    container.append(first, second);
    document.body.append(scroller, container);
    // 容器盒：第一页 0–1100，第二页 1140–2240；视口中线 400 → 第一页。
    expect(measureVisiblePage(container, scroller)).toBe(1);
    first.remove();
    expect(measureVisiblePage(container, scroller)).toBe(1);
    scroller.remove();
    container.remove();
  });
});
