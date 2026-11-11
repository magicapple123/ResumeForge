// SPDX-License-Identifier: Apache-2.0
/**
 * 品牌手势的**键盘兜底**（P5-3 · 13-3/13-4）：`Alt+R` 刷新、`Alt+Home` 回首页。
 *
 * 为什么单独一个文件：这两个动作只有在 `ShortcutProvider` 真的挂上全局 keydown 监听时
 * 才有意义，而 `AppShell.test.tsx` 为了隔离把 `ShortcutProvider` 桩掉了。这里用真实的
 * 注册表 + 真实监听，验的是"按下去真的会发生"。
 *
 * 断言口径：刷新计 `viewRefresh` 的版本号，跳转读真实 pathname；`fireEvent.keyDown` 的
 * 返回值是"有没有被 `preventDefault()`"（false = 被拦截，浏览器默认行为不会抢走按键）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShortcutProvider from "../shortcuts/ShortcutProvider";
import { BRAND_CLICK_SETTLE_MS, useBrandMarkGesture } from "./useBrandMarkGesture";
import { getViewRefreshVersion, resetViewRefreshForTests } from "./viewRefresh";

function Probe() {
  const gesture = useBrandMarkGesture();
  return (
    <button type="button" onClick={gesture.onClick}>
      brand
    </button>
  );
}

function PathProbe() {
  const { pathname } = useLocation();
  return <span data-testid="path">{pathname}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShortcutProvider />
      <Probe />
      <PathProbe />
    </MemoryRouter>,
  );
}

/** 组合键：只给 `alt`（本批次两个动作都是 Alt 系列）。 */
function pressAlt(key: string, code: string): boolean {
  return fireEvent.keyDown(window, { key, code, altKey: true });
}

beforeEach(() => {
  resetViewRefreshForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("品牌手势 · 键盘兜底（Alt+R / Alt+Home）", () => {
  it("Alt+R 广播一次刷新，并被 preventDefault 拦下", () => {
    renderAt("/tracker");

    expect(pressAlt("r", "KeyR")).toBe(false);

    expect(getViewRefreshVersion()).toBe(1);
    // 刷新不动路由：这是"就地重取"，不是重载页面。
    expect(screen.getByTestId("path").textContent).toBe("/tracker");
  });

  it("Alt+Home 从别的页面回首页", () => {
    renderAt("/tracker");

    expect(pressAlt("Home", "Home")).toBe(false);

    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(getViewRefreshVersion()).toBe(0);
  });

  it("已经在首页时 Alt+Home 等价于刷新", () => {
    renderAt("/");

    pressAlt("Home", "Home");

    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(getViewRefreshVersion()).toBe(1);
  });

  it("不按修饰键的 R / Home 不触发任何动作（不抢键盘）", () => {
    renderAt("/tracker");

    fireEvent.keyDown(window, { key: "r", code: "KeyR" });
    fireEvent.keyDown(window, { key: "Home", code: "Home" });

    expect(getViewRefreshVersion()).toBe(0);
    expect(screen.getByTestId("path").textContent).toBe("/tracker");
  });
});

/**
 * 滚动语义：**单击立刻回顶部、双击不动滚动位置**。
 *
 * jsdom 没有布局，`scrollTop` 恒为 0 且不可写，所以这里自己搭一条真实的滚动链：
 * `.app-main > .ant-layout-content.app-content` 上把 `scrollTop` 换成可读写属性，
 * `scrollTo` 换成 spy。断言的是"调用了什么、最终停在哪里"，与真实浏览器的行为一致
 * （真实环境已由 `evidence/P5-1` 的 Playwright 量测交叉验证）。
 */
describe("品牌手势 · 滚动位置", () => {
  interface ScrollHarness {
    content: HTMLElement;
    position: () => number;
    scrollTo: ReturnType<typeof vi.fn>;
  }

  function mountScrollHarness(startAt: number): ScrollHarness {
    // jsdom 没有实现 window.scrollTo，会往 stderr 写 "Not implemented"；直接桩掉。
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const main = document.createElement("div");
    main.className = "app-main";
    const content = document.createElement("div");
    content.className = "ant-layout-content app-content";
    main.appendChild(content);
    document.body.appendChild(main);
    let top = startAt;
    Object.defineProperty(content, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      // 平滑滚动在 jsdom 里不会真的走动画，这里直接跳到目标值即可。
      if (options?.top !== undefined) top = options.top;
    });
    Object.defineProperty(content, "scrollTo", { configurable: true, value: scrollTo });
    return { content, position: () => top, scrollTo };
  }

  it("单击：立刻请求滚到顶部，结算后位置保持 0（不撤销）", () => {
    vi.useFakeTimers();
    const harness = mountScrollHarness(800);
    renderAt("/tracker");

    fireEvent.click(screen.getByRole("button", { name: "brand" }));

    // 第一击就起滚：单击不能被 400ms 的结算窗口拖慢。
    expect(harness.scrollTo).toHaveBeenCalledTimes(1);
    expect(harness.scrollTo.mock.calls[0][0]).toMatchObject({ top: 0, behavior: "smooth" });
    expect(harness.position()).toBe(0);

    vi.advanceTimersByTime(BRAND_CLICK_SETTLE_MS);

    // 单击结算 = 什么都不补做：不刷新、也不把位置放回去。
    expect(getViewRefreshVersion()).toBe(0);
    expect(harness.position()).toBe(0);
  });

  it("双击：第二击撤销第一击的回顶，滚动位置原样保留并刷新一次", () => {
    vi.useFakeTimers();
    const harness = mountScrollHarness(812);
    renderAt("/tracker");
    const brand = screen.getByRole("button", { name: "brand" });

    fireEvent.click(brand);
    fireEvent.click(brand);

    // 关键断言：双击的第一次点击也是单击，不能把用户从列表中部弹回顶部。
    expect(harness.position()).toBe(812);

    vi.advanceTimersByTime(BRAND_CLICK_SETTLE_MS);

    expect(getViewRefreshVersion()).toBe(1);
    expect(harness.position()).toBe(812);
    expect(screen.getByTestId("path").textContent).toBe("/tracker");
  });

  it("三击：回首页（位置不再相关，也不会多刷一次）", () => {
    vi.useFakeTimers();
    const harness = mountScrollHarness(640);
    renderAt("/tracker");
    const brand = screen.getByRole("button", { name: "brand" });

    fireEvent.click(brand);
    fireEvent.click(brand);
    fireEvent.click(brand);

    expect(screen.getByTestId("path").textContent).toBe("/");
    vi.advanceTimersByTime(BRAND_CLICK_SETTLE_MS);
    // 三击走的是 goHome，不额外广播刷新（已在首页才是刷新语义）。
    expect(getViewRefreshVersion()).toBe(0);
    expect(harness.position()).toBe(640);
  });
});
