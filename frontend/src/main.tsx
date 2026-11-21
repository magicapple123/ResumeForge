// SPDX-License-Identifier: Apache-2.0
import NotifyHostBridge from "./features/shell/NotifyHostBridge";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, createRoutesFromElements, RouterProvider } from "react-router-dom";
import { Route } from "react-router-dom";
import { APP_ROOT_ROUTE } from "./appRoutes";
import AppErrorBoundary from "./features/shell/AppErrorBoundary";
import RootLayout from "./features/shell/RootLayout";
import ThemeProvider from "./features/theme/ThemeProvider";
import I18nProvider from "./i18n/I18nProvider";
import "./index.css";

/**
 * 在线体验模式：先装好请求拦截层，再挂载应用。
 *
 * 这一段是**静态判断 + 动态 import**，不是普通的条件渲染：`VITE_DEMO_MODE` 只在
 * 演示构建里为 "1"，普通构建时 `if` 恒假，打包器会把整个 `./demo/*` 子树摇掉，
 * 主发行包里不会多出一行演示代码，也不会多出几百 KB 的快照引用。
 *
 * 顺序不能反：首屏的几个请求（`/api/stats`、`/api/reminders/upcoming`…）在
 * `App` 挂载时立刻发出，拦截层必须在那一刻之前就位，否则会打到不存在的后端上。
 */
async function start() {
  if (import.meta.env.VITE_DEMO_MODE === "1") {
    const { bootstrapDemoMode } = await import("./demo/demoBootstrap");
    try {
      await bootstrapDemoMode();
    } catch {
      // `bootstrapDemoMode` 内部已经装了拦截层并打印了原因；这里继续挂载，
      // 让页面走各自的空态/错误态，用户看到的是"演示数据未就绪"而不是白屏。
    }
  }

  // **必须是 data router**：资料页的未保存离开守卫用 `useBlocker`，声明式
  // `<BrowserRouter>` 下会抛 "useBlocker must be used within a data router" 并落到
  // 错误页。根路由表来自 appRoutes.tsx，与测试里的 `<Routes>` 共用同一份。
  //
  // `basename` 只在「子路径部署」时才有值：官网的在线体验站嵌在
  // `/ResumeForge-official/demo-app/`（镜像站是 `/resumeforge/demo-app/`）下，入口页
  // 会在解析阶段把本站目录写进 `window.__RF_BASE__`。不给 basename 的话，router 首次
  // 规范化会把地址改写成 `/`——地址栏变成站点根、刷新直接离开演示站，favicon 之类的
  // 绝对路径也会跟着指到域根。桌面端没有这个全局，行为与以前完全一致。
  const runtimeBase = (window as Window & { __RF_BASE__?: string }).__RF_BASE__;
  const router = createBrowserRouter(
    createRoutesFromElements(<Route element={<RootLayout />}>{APP_ROOT_ROUTE}</Route>),
    runtimeBase ? { basename: runtimeBase } : undefined,
  );

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {/* 语言在最外层：`ThemeProvider` 里的 antd `locale` 与界面文案必须同源，
          所以它要能读到 `useLocale()`。 */}
      <I18nProvider>
        <ThemeProvider>
          {/* 把 AntD 的通知/弹窗实例交给 utils/taskNotify：生成完成后"弹窗 + 提示声"这件事
              需要一个能在任何模块里调用的出口，而 useApp() 只能在组件里用。 */}
          <NotifyHostBridge />
          <AppErrorBoundary>
            <RouterProvider router={router} />
          </AppErrorBoundary>
        </ThemeProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
}

void start();
