// SPDX-License-Identifier: Apache-2.0
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/shell/AppShell";
import { useSliderDragGuard } from "./hooks/useSliderDragGuard";
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

// 保留原来的导出位置：首页快捷入口（ShortcutsCard）与在线演示测试从这里取完整导航清单。
// 直接从 navigationConfig 再导出，避免 App.tsx 为了"顺手带一个常量"重新依赖导航实现。
export { MENU_ITEMS } from "./components/navigation/navigationConfig";

/**
 * 路由表 + 全局挂载点。
 *
 * 布局（侧栏/页头/内容区/预热/导游弹窗）全部在 `components/shell/AppShell.tsx`：
 * 这个文件只回答"哪个路径渲染哪个页面"，改布局不需要经过这里。
 */
export default function App() {
  // 全局挂一次：任何一屏拖滑杆时都让 iframe 暂时不吃指针事件（否则松手事件会丢，
  // 滑杆停在"正在拖"）。细节见 hooks/useSliderDragGuard.ts。
  useSliderDragGuard();
  return (
    <Routes>
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
    </Routes>
  );
}
