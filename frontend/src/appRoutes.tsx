// SPDX-License-Identifier: Apache-2.0
/**
 * 路由表唯一来源：生产的 **data router** 与测试里的声明式 `<Routes>` 共用同一棵 Route 元素树。
 *
 * 为什么单独抽出（2026-10-25 修复）：资料页的未保存离开守卫用 react-router 的
 * `useBlocker`，它**要求运行在 data router**（`createBrowserRouter` + `RouterProvider`）里。
 * 入口此前用 `<BrowserRouter>`（声明式 Router），点「我的资料」会抛
 * `useBlocker must be used within a data router` 并落到错误页。
 * 现在 `main.tsx` 用 `createBrowserRouter(createRoutesFromElements(APP_ROOT_ROUTE))`，
 * `App.tsx` 仍用 `<Routes>{APP_ROOT_ROUTE}</Routes>`（测试的 MemoryRouter 场景），
 * 两边共用同一份路由表，不会再出现"生产与测试路由不同"。
 */
import type { ReactElement } from "react";
import { Navigate, Route } from "react-router-dom";
import AppShell from "./components/shell/AppShell";
import {
  AnalyticsPage,
  ApplyPage,
  AssistantPage,
  ClaimsPage,
  DrillPage,
  FavoritesPage,
  HomePage,
  InterviewPage,
  JobsPage,
  KnowledgePage,
  MaterialsPage,
  ProfilePage,
  ResumesPage,
  SettingsPage,
  SkillsPage,
  TrackerPage,
  TrashPage,
  WebFormPage,
} from "./pages/registry";

/**
 * 根路由元素：布局（侧栏/页头/内容区）在 `<AppShell />`，本元素只回答"哪个路径渲染哪个页面"。
 *
 * 保留原来的导出位置约定：首页快捷入口（ShortcutsCard）与在线演示测试从 `App.tsx`
 * 取完整导航清单，这里不复制导航数据。
 */
export const APP_ROOT_ROUTE: ReactElement = (
  <Route element={<AppShell />}>
    <Route path="/" element={<HomePage />} />
    <Route path="/jobs" element={<JobsPage />} />
    <Route path="/resumes" element={<ResumesPage />} />
    <Route path="/apply" element={<ApplyPage />} />
    <Route path="/webform" element={<WebFormPage />} />
    <Route path="/tracker" element={<TrackerPage />} />
    <Route path="/analytics" element={<AnalyticsPage />} />
    <Route path="/favorites" element={<FavoritesPage />} />
    <Route path="/assistant" element={<AssistantPage />} />
    <Route path="/materials" element={<MaterialsPage />} />
    <Route path="/knowledge" element={<KnowledgePage />} />
    <Route path="/skills" element={<SkillsPage />} />
    <Route path="/interview" element={<InterviewPage />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/claims" element={<ClaimsPage />} />
    <Route path="/trash" element={<TrashPage />} />
    <Route path="/claims/drill" element={<DrillPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>
);
