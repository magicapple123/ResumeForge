// SPDX-License-Identifier: Apache-2.0
/**
 * WF-10 品牌图：浅色画星、深色画月，切换时只播一次交替动画。
 *
 * 这里只钉"什么时候播、播多久后收"，动画本身（旋转/缩放/透明度）在 CSS 里，
 * 由 `theme-transition.css` 的 `data-switch` 规则决定。
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeLogo from "./ThemeLogo";
import { THEME_STORAGE_KEY, setThemeMode } from "./themeStore";

function logo(): SVGSVGElement {
  const node = document.querySelector<SVGSVGElement>(".app-brand-logo");
  if (!node) throw new Error("brand logo not rendered");
  return node;
}

describe("ThemeLogo", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.dataset.theme = "light";
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("首屏按当前主题出图，且不播切换动画", () => {
    render(<ThemeLogo />);

    expect(logo()).toHaveAttribute("data-theme", "light");
    expect(logo()).not.toHaveAttribute("data-switch");
    // 两套图层都在 DOM 里（CSS 靠 data-theme 决定谁可见），不是条件渲染。
    expect(document.querySelectorAll(".rf-logo-layer-light")).toHaveLength(2);
    expect(document.querySelectorAll(".rf-logo-layer-dark")).toHaveLength(2);
  });

  it("切到深色：打上 data-switch=dark，动画时限到了自动摘掉", () => {
    render(<ThemeLogo />);

    act(() => setThemeMode("dark"));
    expect(logo()).toHaveAttribute("data-theme", "dark");
    expect(logo()).toHaveAttribute("data-switch", "dark");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    // 摘掉之后由 CSS 的静态规则接管（dark 主题下只显示深色层）。
    expect(logo()).not.toHaveAttribute("data-switch");
    expect(logo()).toHaveAttribute("data-theme", "dark");
  });

  it("切回浅色时方向标记跟着反向", () => {
    render(<ThemeLogo />);

    act(() => setThemeMode("dark"));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => setThemeMode("light"));

    expect(logo()).toHaveAttribute("data-switch", "light");
    expect(logo()).toHaveAttribute("data-theme", "light");
  });
});
