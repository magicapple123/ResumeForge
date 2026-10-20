/**
 * 页头主题切换（A3）：三档图标、选中态实心、切档即写 localStorage 与 `data-theme`。
 *
 * 跟随系统一档用 `matchMedia` 桩验证：系统偏好为深色时，选中「跟随系统」应当立刻
 * 变深，而不是停在浅色。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ThemeSwitch from "./ThemeSwitch";
import { THEME_STORAGE_KEY } from "../features/theme/themeStore";

const originalMatchMedia = window.matchMedia;

function stubSystemPrefersDark(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: prefersDark && query.includes("prefers-color-scheme"),
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

describe("ThemeSwitch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.dataset.theme = "light";
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("渲染三个带名称的图标选项", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("radiogroup", { name: "主题" })).toBeInTheDocument();
    for (const label of ["浅色", "深色", "跟随系统"]) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
  });

  it("切到深色：写 localStorage、改 data-theme，并把选中图标换成实心", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByTitle("深色"));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTitle("深色")).toHaveAttribute("data-filled", "true");
    expect(screen.getByTitle("浅色")).toHaveAttribute("data-filled", "false");
  });

  it("跟随系统：系统偏好深色时解析为深色", () => {
    stubSystemPrefersDark(true);
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByTitle("跟随系统"));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTitle("跟随系统")).toHaveAttribute("data-filled", "true");
  });

  it("从深色切回浅色", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByTitle("浅色"));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
