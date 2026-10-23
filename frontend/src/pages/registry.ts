// SPDX-License-Identifier: Apache-2.0
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * 页面注册表：懒加载工厂 + 18 个页面 chunk。
 *
 * 单独成文件的原因：这份清单同时被两处消费——`AppShell` 的预热表（`*.preload`）与
 * `App.tsx` 的路由表。放在任一处都会让另一个去 import 它，从而把"外壳"和"路由"绑死；
 * 独立成模块后，两边都只依赖它。`preload` 与 `lazy` 共享同一个 promise，所以
 * "悬停侧栏预热"与"真正导航"不会重复请求同一个 chunk。
 */

type LazyPage<Props = Record<string, never>> = LazyExoticComponent<ComponentType<Props>> & {
  preload: () => Promise<{ default: ComponentType<Props> }>;
};

function lazyPage<Props = Record<string, never>>(
  factory: () => Promise<{ default: ComponentType<Props> }>,
): LazyPage<Props> {
  let promise: Promise<{ default: ComponentType<Props> }> | null = null;
  const load = () => {
    promise ??= factory();
    return promise;
  };
  return Object.assign(lazy(load), { preload: load });
}

export const HomePage = lazyPage(() => import("./HomePage"));
export const JobsPage = lazyPage(() => import("./JobsPage"));
export const ProfilePage = lazyPage(() => import("./ProfilePage"));
export const ClaimsPage = lazyPage(() => import("./ClaimsPage"));
export const DrillPage = lazyPage(() => import("./DrillPage"));
export const ResumesPage = lazyPage(() => import("./ResumesPage"));
export const ApplyPage = lazyPage(() => import("./ApplyPage"));
export const WebFormPage = lazyPage(() => import("./WebFormPage"));
export const TrackerPage = lazyPage(() => import("./TrackerPage"));
export const FavoritesPage = lazyPage(() => import("./FavoritesPage"));
export const AssistantPage = lazyPage(() => import("./AssistantPage"));
export const MaterialsPage = lazyPage(() => import("./MaterialsPage"));
export const KnowledgePage = lazyPage(() => import("./KnowledgePage"));
export const SkillsPage = lazyPage(() => import("./SkillsPage"));
export const InterviewPage = lazyPage(() => import("./InterviewPage"));
export const AnalyticsPage = lazyPage(() => import("./AnalyticsPage"));
export const SettingsPage = lazyPage(() => import("./SettingsPage"));
export const TrashPage = lazyPage(() => import("./TrashPage"));
