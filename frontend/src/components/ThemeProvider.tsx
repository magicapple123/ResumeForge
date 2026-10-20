// SPDX-License-Identifier: Apache-2.0
/**
 * 主题装配：把 antd 的 ThemeConfig 切换与 `<html data-theme>` 绑在一处。
 *
 * 为什么单独一个组件而不是写在 `main.tsx` 里：切主题必须触发重渲染，而 `main.tsx`
 * 只在启动时跑一次。`ConfigProvider` 的 `theme` 一变，antd 的整套 token 会重算；
 * 自定义 CSS 走 `[data-theme="dark"]`，两条线都由这里统一驱动。
 *
 * 浅色 / 深色是**两套独立的 ThemeConfig**（`appTheme` / `darkTheme`），不是
 * "一套 token + 算法开关"：antd 的 token 覆盖发生在算法之后，浅色 token 盖到
 * `darkAlgorithm` 上会得到深底 + 深字（2026-10 用户截图里的不可读界面）。
 */
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { appTheme } from "../theme/appTheme";
import { darkTheme } from "../theme/darkTheme";
import {
  applyTheme,
  hydrateThemeFromServer,
  useResolvedTheme,
  useThemeMode,
} from "../features/theme/themeStore";

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeMode();

  useEffect(() => {
    // 首屏先从服务端取一次（跨数据集/换浏览器）；服务端无值时保留本地选择。
    void hydrateThemeFromServer();
  }, []);

  useEffect(() => {
    // 首屏与每次切换都把 data-theme 落到 <html>：避免"主题存了深色、页面却是浅色"。
    applyTheme(mode);
  }, [mode]);

  // 跟随系统时也要在系统切换的那一刻重画：useResolvedTheme 内部订阅了 matchMedia。
  const dark = useResolvedTheme() === "dark";

  return (
    <ConfigProvider
      locale={zhCN}
      theme={dark ? darkTheme : appTheme}
      getPopupContainer={() => document.body}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
