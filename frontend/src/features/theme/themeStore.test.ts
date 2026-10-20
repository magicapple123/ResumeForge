// SPDX-License-Identifier: Apache-2.0
/**
 * 主题存储（R18）：浅色 / 深色 / 跟随系统。
 *
 * 钉住三件事：选择会被持久化并在刷新后恢复、`<html data-theme>` 与之一致（CSS 靠它）、
 * "跟随系统"真的跟随（系统偏好变了要重画），以及非法值不会让页面卡在无主题状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeMode,
  hydrateThemeFromServer,
  resolveTheme,
  setThemeMode,
  toggleTheme,
} from "./themeStore";

const apiMocks = vi.hoisted(() => ({
  getGlobalTheme: vi.fn(),
  saveGlobalTheme: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("dark") ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return {
    flip(next: boolean) {
      prefersDark = next;
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  stubMatchMedia(false);
  apiMocks.getGlobalTheme.mockReset().mockResolvedValue({ theme: null });
  apiMocks.saveGlobalTheme.mockReset().mockResolvedValue({ theme: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("themeStore", () => {
  it("默认浅色，并把它写到 <html data-theme>", () => {
    expect(getThemeMode()).toBe("light");

    applyTheme();

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("切到深色后持久化，并同步 data-theme 与 color-scheme", () => {
    setThemeMode("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(getThemeMode()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // 原生控件（滚动条/日期选择器）也跟随，否则深色页面上会冒出白色滚动条。
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("非法值回落到浅色，不会把页面卡在「没有主题」的状态", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "midnight");

    expect(getThemeMode()).toBe("light");
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("跟随系统时按系统偏好解析", () => {
    stubMatchMedia(true);
    setThemeMode("system");

    expect(resolveTheme("system")).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("dark");

    // 系统切成浅色 → 解析结果跟着变。
    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("toggle 在浅色与深色之间切换（跟随系统时按当前实际显示取反）", () => {
    stubMatchMedia(true);
    setThemeMode("system");
    // 系统是深色 → 切一次应该到浅色，且不再是"跟随系统"。
    expect(toggleTheme()).toBe("light");
    expect(getThemeMode()).toBe("light");

    expect(toggleTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("主题服务端持久化（R18）", () => {
  it("服务端有值时以服务端为准（覆盖本地），并写回 localStorage", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    apiMocks.getGlobalTheme.mockResolvedValue({ theme: "dark" });

    await hydrateThemeFromServer();

    expect(getThemeMode()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("服务端返回 null 时保留本地值，不拿默认浅色覆盖", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    applyTheme();
    apiMocks.getGlobalTheme.mockResolvedValue({ theme: null });

    await hydrateThemeFromServer();

    expect(getThemeMode()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("请求失败时保留本地值且不抛错（离线兜底）", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    applyTheme();
    apiMocks.getGlobalTheme.mockRejectedValue(new Error("offline"));

    await expect(hydrateThemeFromServer()).resolves.toBeUndefined();

    expect(getThemeMode()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("保存失败不影响本次切换，也不向调用方抛错", async () => {
    apiMocks.saveGlobalTheme.mockRejectedValue(new Error("readonly"));

    expect(() => setThemeMode("dark")).not.toThrow();
    await Promise.resolve();

    expect(getThemeMode()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("切换时 best-effort 保存到服务端", () => {
    setThemeMode("system");

    expect(apiMocks.saveGlobalTheme).toHaveBeenCalledWith("system");
  });
});
