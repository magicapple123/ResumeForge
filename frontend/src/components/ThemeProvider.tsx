/**
 * 主题装配：把 antd 的算法切换与 `<html data-theme>` 绑在一处。
 *
 * 为什么单独一个组件而不是写在 `main.tsx` 里：切主题必须触发重渲染，而 `main.tsx`
 * 只在启动时跑一次。`ConfigProvider` 的 `algorithm` 一变，antd 的整套 token 会重算；
 * 自定义 CSS 走 `[data-theme="dark"]`，两条线都由这里统一驱动。
 */
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { appTheme } from "../theme/appTheme";
import { layer } from "../theme/tokens";
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
      theme={{
        ...appTheme,
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { ...appTheme.token, zIndexPopupBase: layer.popupBase },
        components: dark
          ? {
              ...appTheme.components,
              // 深色下表格表头与选中项的品牌底色要反过来用：浅品牌 tint 在深底上
              // 会变成一块突兀的亮斑。
              Table: { ...appTheme.components?.Table, headerBg: "#232833", headerColor: "#dbe4f0" },
              Menu: { itemSelectedBg: "#1f2a3a", itemSelectedColor: "#cfe0f7" },
              Select: { optionSelectedBg: "#1f2a3a", optionSelectedColor: "#cfe0f7" },
            }
          : appTheme.components,
      }}
      getPopupContainer={() => document.body}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
