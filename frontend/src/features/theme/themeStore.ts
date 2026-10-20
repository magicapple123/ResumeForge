// SPDX-License-Identifier: Apache-2.0
/**
 * 主题（R18）：浅色 / 深色 / 跟随系统。
 *
 * 为什么只有三档而不是"自定义配色"：这一版先把**外壳**变暗（计划决策 D4），
 * 简历预览 iframe 始终是白纸——导出与打印看到的就是屏幕上的那张纸，不跟着主题变。
 *
 * 状态存 localStorage 的 `rf.theme`；`data-theme` 挂在 `<html>` 上，CSS 用
 * `[data-theme="dark"]` 覆盖语义变量（`theme/dark-tokens.css`）。antd 组件由
 * `darkAlgorithm` 负责，两边合起来才没有"半明半暗"的接缝。
 */
import { useSyncExternalStore } from "react";
import { getGlobalTheme, saveGlobalTheme } from "../../api/settings";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "rf.theme";

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedMode: ThemeMode = "light";
let systemQuery: MediaQueryList | null = null;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // 隐私模式下访问 localStorage 本身就会抛错：退化成"只在内存里生效"。
    return null;
  }
}

function normalize(value: string | null): ThemeMode {
  return value === "dark" || value === "system" || value === "light" ? value : "light";
}

/** 引用稳定的快照（`useSyncExternalStore` 的 getSnapshot）。 */
export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const raw = storage()?.getItem(THEME_STORAGE_KEY) ?? null;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedMode = normalize(raw);
  }
  return cachedMode;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(mode: ThemeMode = getThemeMode()): ResolvedTheme {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** 把当前主题写到 `<html data-theme>`：CSS 与 `color-scheme` 都从这里取。 */
export function applyTheme(mode: ThemeMode = getThemeMode()): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  // 让原生控件（滚动条、日期选择器、输入框自动填充）跟着变，不然深色页面上会
  // 冒出一条白色滚动条。
  document.documentElement.style.colorScheme = resolved;
}

/** 只改本地状态（localStorage + data-theme + 通知订阅者），不写服务端。 */
function applyLocalMode(mode: ThemeMode): void {
  const next = normalize(mode);
  try {
    storage()?.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // 写不进去不影响本次会话：内存快照照样切换。
  }
  cachedRaw = next;
  cachedMode = next;
  applyTheme(next);
  for (const listener of Array.from(listeners)) listener();
}

export function setThemeMode(mode: ThemeMode): void {
  applyLocalMode(mode);
  // 服务端持久化是 best-effort：失败不回滚本切换，也不弹错误（离线/老后端都能用）。
  void saveGlobalTheme(normalize(mode)).catch(() => {});
}

/**
 * 启动时从服务端取主题（跨数据集、换浏览器不丢）。
 *
 * 服务端有值就以它为准（写回 localStorage 并 apply）；返回 null 或请求失败时
 * 保留 localStorage 现值——绝不能用默认浅色覆盖用户的本地选择。
 */
export async function hydrateThemeFromServer(): Promise<void> {
  try {
    const { theme } = await getGlobalTheme();
    if (theme === "light" || theme === "dark" || theme === "system") {
      applyLocalMode(theme);
    }
  } catch {
    // 服务端暂时不可用：本地值就是最终值（离线兜底）。
  }
}

/** 浅色 ⇄ 深色（跟随系统时按当前实际显示取反）。 */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = resolveTheme() === "dark" ? "light" : "dark";
  setThemeMode(next);
  return next;
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getThemeMode, getThemeMode);
}

/** 实际生效的主题（"跟随系统"时随系统变化）。 */
export function useResolvedTheme(): ResolvedTheme {
  const mode = useThemeMode();
  // 订阅系统的深浅色变化：只在"跟随系统"时有意义，但订阅本身无副作用。
  const prefersDark = useSyncExternalStore(
    (listener) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      systemQuery ??= window.matchMedia("(prefers-color-scheme: dark)");
      systemQuery.addEventListener?.("change", listener);
      return () => systemQuery?.removeEventListener?.("change", listener);
    },
    () => systemPrefersDark(),
    () => false,
  );
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}
