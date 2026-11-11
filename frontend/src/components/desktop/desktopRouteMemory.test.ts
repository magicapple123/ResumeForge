// SPDX-License-Identifier: Apache-2.0
/**
 * #34E「刷新不丢当前路由」的路由记忆（纯函数 + hook）。
 *
 * 两层保证里，主进程那层只做 reload（URL 不变，见 desktop/scripts/test-desktop-menu-actions.js），
 * 这里守第二层：路由记进 sessionStorage，启动落在站点根时恢复回去。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_ROUTE_STORAGE_KEY,
  currentNavigationType,
  isRestorableRoute,
  readRememberedRoute,
  rememberRoute,
  routeSnapshot,
  shouldRestoreRoute,
  useDesktopRouteMemory,
  type DesktopRouteStorage,
} from "./desktopRouteMemory";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const storage: DesktopRouteStorage = {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  return { storage, store };
}

describe("routeSnapshot", () => {
  it("path + query + hash 全带上（三者少一个都会丢上下文）", () => {
    expect(routeSnapshot({ pathname: "/settings", search: "?tab=data", hash: "#top" })).toBe(
      "/settings?tab=data#top",
    );
    expect(routeSnapshot({ pathname: "/", search: "", hash: "" })).toBe("/");
  });
});

describe("isRestorableRoute", () => {
  it("只接受应用内绝对路径", () => {
    expect(isRestorableRoute("/resumes?x=1")).toBe(true);
    expect(isRestorableRoute("//evil.example/path")).toBe(false);
    expect(isRestorableRoute("https://evil.example")).toBe(false);
    expect(isRestorableRoute("resumes")).toBe(false);
    expect(isRestorableRoute(null)).toBe(false);
    expect(isRestorableRoute(`/${"a".repeat(2100)}`)).toBe(false);
  });
});

describe("remember / read", () => {
  it("写入后能读回；storage 抛异常时静默（记不住路由不该让刷新失败）", () => {
    const { storage } = memoryStorage();
    rememberRoute(storage, "/jobs?page=2");
    expect(readRememberedRoute(storage)).toBe("/jobs?page=2");
    expect(storage.getItem(DESKTOP_ROUTE_STORAGE_KEY)).toBe("/jobs?page=2");

    const broken: DesktopRouteStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => rememberRoute(broken, "/a")).not.toThrow();
    expect(readRememberedRoute(broken)).toBeNull();
  });

  it("写入非法路由（协议相对地址）被忽略", () => {
    const { storage } = memoryStorage();
    rememberRoute(storage, "//evil.example");
    expect(readRememberedRoute(storage)).toBeNull();
  });
});

describe("shouldRestoreRoute", () => {
  it("只有 reload + 落在站点根 + 记过别的路由才恢复", () => {
    expect(
      shouldRestoreRoute({
        remembered: "/jobs?page=2",
        current: "/",
        navigationType: "reload",
      }),
    ).toBe(true);
    expect(
      shouldRestoreRoute({
        remembered: "/jobs?page=2",
        current: "/?tab=x",
        navigationType: "reload",
      }),
    ).toBe(true);
  });

  it("不是 reload（普通导航 / 首次启动）不恢复——否则打开应用会自己跳页面", () => {
    expect(
      shouldRestoreRoute({ remembered: "/jobs", current: "/", navigationType: "navigate" }),
    ).toBe(false);
  });

  it("URL 已经带着更深的路由时不覆盖（reload 保留 URL 是常态）", () => {
    expect(
      shouldRestoreRoute({
        remembered: "/jobs",
        current: "/settings?tab=data",
        navigationType: "reload",
      }),
    ).toBe(false);
  });

  it("没有记忆或记忆与当前相同：不动", () => {
    expect(shouldRestoreRoute({ remembered: null, current: "/", navigationType: "reload" })).toBe(
      false,
    );
    expect(shouldRestoreRoute({ remembered: "/", current: "/", navigationType: "reload" })).toBe(
      false,
    );
  });
});

describe("currentNavigationType", () => {
  it("jsdom 里拿不到 navigation entry 时按 navigate（测试里不自动恢复路由）", () => {
    expect(currentNavigationType()).toBe("navigate");
  });
});

describe("useDesktopRouteMemory", () => {
  it("reload 落回根路径时用 replace 恢复上一次路由", () => {
    const { storage } = memoryStorage({ [DESKTOP_ROUTE_STORAGE_KEY]: "/jobs?page=2#list" });
    const navigate = vi.fn();
    renderHook(() =>
      useDesktopRouteMemory(
        navigate,
        { pathname: "/", search: "", hash: "" },
        {
          storage,
          navigationType: () => "reload",
        },
      ),
    );
    expect(navigate).toHaveBeenCalledWith("/jobs?page=2#list", { replace: true });
  });

  it("普通导航不恢复", () => {
    const { storage } = memoryStorage({ [DESKTOP_ROUTE_STORAGE_KEY]: "/jobs" });
    const navigate = vi.fn();
    renderHook(() =>
      useDesktopRouteMemory(
        navigate,
        { pathname: "/", search: "", hash: "" },
        {
          storage,
          navigationType: () => "navigate",
        },
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("每次路由变化都记一份（刷新前的最后一次路由就是它）", () => {
    const { storage } = memoryStorage();
    const navigate = vi.fn();
    const { rerender } = renderHook(
      ({ pathname }) =>
        useDesktopRouteMemory(navigate, { pathname, search: "", hash: "" }, { storage }),
      { initialProps: { pathname: "/settings" } },
    );
    expect(readRememberedRoute(storage)).toBe("/settings");
    rerender({ pathname: "/jobs" });
    expect(readRememberedRoute(storage)).toBe("/jobs");
  });
});
