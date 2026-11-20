// SPDX-License-Identifier: Apache-2.0
/**
 * WF-09 主题切换圆形扩散的纯逻辑：半径要把最远的角盖住、圆心取控件中心、
 * 不支持 View Transitions 或减少动态效果时退回直接切换。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVEAL_DURATION_MS,
  prefersReducedMotion,
  revealRadius,
  startThemeTransition,
  themeSwitchOrigin,
} from "./themeTransition";
import {
  beginTitlebarOverlayFlip,
  publishTitlebarOverlay,
  resetTitlebarOverlayState,
  setTitlebarOverlaySink,
} from "./titlebarOverlay";

const originalMatchMedia = window.matchMedia;

function stubReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  for (const name of ["--rf-theme-x", "--rf-theme-y", "--rf-theme-r", "--rf-theme-duration"]) {
    document.documentElement.style.removeProperty(name);
  }
  resetTitlebarOverlayState();
  vi.unstubAllGlobals();
});

describe("revealRadius", () => {
  it("取到视口最远角的距离（以左上角为圆心时等于对角线）", () => {
    expect(revealRadius(0, 0, 3, 4)).toBeCloseTo(5);
  });

  it("圆心在右下角时同样盖满全屏", () => {
    expect(revealRadius(3, 4, 3, 4)).toBeCloseTo(5);
  });

  it("圆心在中间时取四个角里最远的那个", () => {
    expect(revealRadius(50, 50, 100, 100)).toBeCloseTo(Math.hypot(50, 50));
  });
});

describe("themeSwitchOrigin", () => {
  it("取元素矩形中心", () => {
    const element = {
      getBoundingClientRect: () => ({ left: 400, top: 20, width: 100, height: 40 }),
    } as unknown as Element;
    expect(themeSwitchOrigin(element)).toEqual({ x: 450, y: 40 });
  });

  it("元素不存在或没有布局时退回视口中心", () => {
    expect(themeSwitchOrigin(null)).toEqual({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const empty = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    } as unknown as Element;
    expect(themeSwitchOrigin(empty)).toEqual({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  });
});

describe("startThemeTransition", () => {
  it("不支持 View Transitions 时直接切换，且不写自定义属性", () => {
    const apply = vi.fn();
    startThemeTransition("dark", { x: 10, y: 10 }, apply);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue("--rf-theme-duration")).toBe("");
  });

  it("reduced-motion 时不启动过渡（即使浏览器支持）", () => {
    stubReducedMotion(true);
    const start = vi.fn();
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;
    const apply = vi.fn();

    startThemeTransition("light", { x: 10, y: 10 }, apply);

    expect(prefersReducedMotion()).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("支持时先写圆心/半径/时长，再在回调里完成切换（开灯 560ms、关灯 460ms）", () => {
    stubReducedMotion(false);
    const apply = vi.fn();
    let callback: (() => void | Promise<void>) | null = null;
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = vi.fn(
      (cb: () => void | Promise<void>) => {
        callback = cb;
        return { finished: Promise.resolve() };
      },
    );

    startThemeTransition("light", { x: 120, y: 60 }, apply);

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--rf-theme-x")).toBe("120px");
    expect(root.style.getPropertyValue("--rf-theme-duration")).toBe(
      `${REVEAL_DURATION_MS.light}ms`,
    );
    expect(apply).not.toHaveBeenCalled();
    void callback!();
    expect(apply).toHaveBeenCalledTimes(1);

    startThemeTransition("dark", { x: 120, y: 60 }, apply);
    expect(root.style.getPropertyValue("--rf-theme-duration")).toBe(`${REVEAL_DURATION_MS.dark}ms`);
    expect(REVEAL_DURATION_MS).toEqual({ light: 560, dark: 460 });

    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("过渡期间覆盖层交给插值器（普通上报被丢弃），结束后交还（第 4 条）", async () => {
    stubReducedMotion(false);
    const sent: unknown[] = [];
    setTitlebarOverlaySink((payload) => sent.push(payload));
    let finished: () => void = () => undefined;
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = vi.fn(() => ({
      finished: new Promise<void>((resolve) => {
        finished = resolve;
      }),
    }));

    startThemeTransition("dark", { x: 10, y: 10 }, () => undefined);

    // 过渡已经开始（begin 已占位）：这时 DesktopTitleBar 的 useEffect 会想直接上报，
    // 必须被丢弃——否则就是"第 0 帧突变"。
    expect(publishTitlebarOverlay({ theme: "dark", color: "#151b23" })).toBe(false);
    expect(sent).toHaveLength(0);

    finished();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 收尾之后普通上报恢复（cancel 会先把当前 CSS 值落一次）。
    expect(publishTitlebarOverlay({ theme: "dark", color: "#151b23" })).toBe(true);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("退化为直接切换（无 View Transitions / reduced-motion）时不占用覆盖层", () => {
    stubReducedMotion(true);
    setTitlebarOverlaySink(() => undefined);
    const apply = vi.fn();
    startThemeTransition("dark", { x: 10, y: 10 }, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    // 没有过渡就没有插值器掌权：普通上报照旧可用。
    expect(publishTitlebarOverlay({ theme: "dark" })).toBe(true);
    // begin 只在真正开过渡时才调用（这里调一次做参照，确认它确实会占位）。
    const handle = beginTitlebarOverlayFlip({
      next: "dark",
      origin: { x: 0, y: 0 },
      durationMs: 460,
      radius: 100,
    });
    expect(handle.active).toBe(true);
    handle.cancel();
  });
});
