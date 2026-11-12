// SPDX-License-Identifier: Apache-2.0
/**
 * 「重新加载之后还停在原页面」（#34E）。
 *
 * 两层保证：
 *  1. `webContents.reload()` 重新加载的是**同一个 URL**（path / query / hash 都在 URL
 *     里），正常情况下路由本来就保住了；
 *  2. 这一层是兜底：把当前路由记进 sessionStorage；启动时如果发现"这次是 reload"且
 *     URL 落回了站点根，就把上一次的路由恢复回去。没有第 2 层时，reload 只要在哪儿
 *     被改成"回到首页"，用户就丢一次上下文（在哪一页、哪个 tab、哪条 query）。
 *
 * 为什么是 sessionStorage 而不是 localStorage：只在本次会话里有效。跨重启"记得上次
 * 的临时页面"不是用户预期，而且那也会让"打开应用"变成一个会自己跳页面的东西。
 */
import { useEffect, useRef } from "react";

export const DESKTOP_ROUTE_STORAGE_KEY = "resumeforge.desktop.route.v1";

/** 只依赖 `location` 的这几个字段（react-router 的 Location 与 jsdom Location 都满足）。 */
export interface RouteLocationLike {
  pathname: string;
  search: string;
  hash: string;
}

/** sessionStorage 的最小子集；测试注入内存实现，不用碰真 storage。 */
export interface DesktopRouteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 规范化成 `/path?query#hash`（缺字段按空串处理，不产生 "undefined"）。 */
export function routeSnapshot(location: RouteLocationLike): string {
  const pathname = location.pathname || "/";
  const search = location.search || "";
  const hash = location.hash || "";
  return `${pathname}${search}${hash}`;
}

/**
 * 只接受"应用内路径"：必须斜杠开头、不能是协议相对地址（`//evil.example`）。
 * 恢复路由走 `navigate()` 不碰 `window.location`，但仍按最小暴露面校验一次。
 */
export function isRestorableRoute(value: string | null): value is string {
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  return !value.startsWith("//") && value.length <= 2048;
}

export function readRememberedRoute(storage: DesktopRouteStorage | null): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(DESKTOP_ROUTE_STORAGE_KEY);
    return isRestorableRoute(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberRoute(storage: DesktopRouteStorage | null, snapshot: string): void {
  if (!storage || !isRestorableRoute(snapshot)) return;
  try {
    storage.setItem(DESKTOP_ROUTE_STORAGE_KEY, snapshot);
  } catch {
    // 隐私模式 / 配额已满：记不住路由只影响"刷新后回到哪一页"，不该让刷新本身失败。
  }
}

/**
 * 这次启动是不是一次 reload。
 *
 * jsdom（测试）里 `performance.getEntriesByType("navigation")` 是空数组，取不到就按
 * `navigate` 处理——**不恢复**：测试里看到的路由跳转必须是代码显式做的。
 */
export function currentNavigationType(): string {
  try {
    const entries = performance.getEntriesByType?.("navigation") as
      Array<{ type?: string }> | undefined;
    return entries?.[0]?.type ?? "navigate";
  } catch {
    return "navigate";
  }
}

/** 只有"这次是 reload" + "URL 落回站点根" + "记过一条别的路由"三个条件同时成立才恢复。 */
export function shouldRestoreRoute(input: {
  remembered: string | null;
  current: string;
  navigationType: string;
}): boolean {
  const { remembered, current, navigationType } = input;
  if (navigationType !== "reload") return false;
  if (!isRestorableRoute(remembered)) return false;
  if (remembered === current) return false;
  // 只看 pathname 是不是根：reload 落在 `/?tab=x` 也算"回了首页"，同样要恢复。
  return (current.split(/[?#]/)[0] || "/") === "/";
}

export interface UseDesktopRouteMemoryOptions {
  storage?: DesktopRouteStorage | null;
  navigationType?: () => string;
}

/**
 * 挂在桌面标题栏里（只有桌面壳会渲染它）：
 *  - 每次路由变化记一份快照；
 *  - 挂载时只在这是一次 reload 的情况下恢复一次。
 */
export function useDesktopRouteMemory(
  navigate: (path: string, options?: { replace?: boolean }) => void,
  location: RouteLocationLike,
  options: UseDesktopRouteMemoryOptions = {},
): void {
  // navigate 每次 render 都可能是新引用（useNavigate 的返回值不保证稳定），
  // 但恢复只发生在挂载那一刻，所以用 effect 同步 ref，不在 render 里写 ref。
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const storage = options.storage === undefined ? readSessionStorage() : options.storage;
  const navigationType = options.navigationType ?? currentNavigationType;
  const snapshot = routeSnapshot(location);

  // 挂载时恢复一次（依赖列表刻意留空：只在启动那一刻判断，之后路由变化不再触发）。
  const restoreRef = useRef(false);
  useEffect(() => {
    if (restoreRef.current) return;
    restoreRef.current = true;
    const remembered = readRememberedRoute(storage);
    const restoreTarget = remembered;
    if (
      !isRestorableRoute(restoreTarget) ||
      !shouldRestoreRoute({
        remembered: restoreTarget,
        current: snapshot,
        navigationType: navigationType(),
      })
    ) {
      return;
    }
    navigateRef.current(restoreTarget, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时判一次
  }, []);

  useEffect(() => {
    rememberRoute(storage, snapshot);
  }, [storage, snapshot]);
}

/** sessionStorage 可能被策略禁用（throw）；拿不到就当"没有记忆"。 */
function readSessionStorage(): DesktopRouteStorage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}
