// SPDX-License-Identifier: Apache-2.0
import {
  createElement,
  lazy,
  type ComponentType,
  type FunctionComponent,
  type LazyExoticComponent,
} from "react";

import type { AssistantPageProps } from "./assistantPageTypes";

/**
 * 页面注册表：懒加载工厂 + 18 个页面 chunk。
 *
 * 单独成文件的原因：这份清单同时被两处消费——`AppShell` 的预热表（`*.preload`）与
 * `App.tsx` 的路由表。放在任一处都会让另一个去 import 它，从而把"外壳"和"路由"绑死；
 * 独立成模块后，两边都只依赖它。`preload` 与 `lazy` 共享同一个 promise，所以
 * "悬停侧栏预热"与"真正导航"不会重复请求同一个 chunk。
 */

type LazyPage<Props extends object = Record<string, never>> = LazyExoticComponent<
  ComponentType<Props>
> & {
  preload: () => Promise<{ default: ComponentType<Props> }>;
};

/**
 * 懒加载页面工厂（导出供测试直接钉住缓存/失败恢复行为，生产用途仍只是下面这份清单）。
 *
 * 三条性质：
 * 1. 同一加载窗口内并发多次调用只执行一次 `factory`（导航 + 悬停预热共享同一个 promise）；
 * 2. 成功结果永久复用（换字号、切路由都不会再取一次 chunk）；
 * 3. **失败结果不缓存**，而且下一次渲染要拿到一个**全新的 `lazy()`**。
 *
 * 第 3 条的后半句是重点：只清我们自己的 promise 并不够——`React.lazy` 在内部把
 * "已经 rejected"作为它自己那层的终态缓存下来，同一个 lazy 组件之后再渲染永远不会重试
 * （2026-10-24 的回归用例在渲染层证明了这一点）。所以失败时把 `Current` 换成一个新的
 * `lazy(load)`：外层组件身份保持不变（路由树不重挂），内层组件类型变化会强制 React
 * 重新初始化 lazy，下一次渲染（错误边界的「重试」）才会真的再取一次 chunk。
 *
 * 观感上的差别：没有这一条，用户在一次网络抖动之后点进某个页面就永远是
 * "页面代码没能加载完整"，只能整页刷新；有了它，「重试」按钮能真正修好。
 */
export function lazyPage<Props extends object = Record<string, never>>(
  factory: () => Promise<{ default: ComponentType<Props> }>,
): LazyPage<Props> {
  let promise: Promise<{ default: ComponentType<Props> }> | null = null;
  let Current: LazyExoticComponent<ComponentType<Props>>;
  const load = () => {
    promise ??= factory().catch((error: unknown) => {
      // 先清缓存再抛：并发等待者都收到这一次的失败，而下一个调用者重新开始。
      promise = null;
      Current = lazy(load);
      throw error;
    });
    return promise;
  };
  Current = lazy(load);

  // 稳定的外层组件：React 看到的路由组件类型不变，失败时不会把整棵路由树换掉；
  // 它每次渲染都取当时的 `Current`，于是失败后的新 lazy 能在重试时生效。
  //
  // 这里的两次 `as unknown as` 是必要的：`Current` 的运行期类型是 `lazy(...)` 返回的
  // exotic component，而 `createElement` 的重载只接受普通函数/类组件。显式给出 `Props`
  // 泛型参数，才能让"没有 props 的页面"与"带 props 的页面"共用同一份工厂而不被
  // 重载解析拒收。转换不改变任何运行期行为。
  const Page: FunctionComponent<Props> = (props) =>
    createElement<Props>(Current as unknown as ComponentType<Props>, props);
  return Object.assign(Page, { preload: load }) as unknown as LazyPage<Props>;
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
export const AssistantPage = lazyPage<AssistantPageProps>(() => import("./AssistantPage"));
export const MaterialsPage = lazyPage(() => import("./MaterialsPage"));
export const KnowledgePage = lazyPage(() => import("./KnowledgePage"));
export const SkillsPage = lazyPage(() => import("./SkillsPage"));
export const InterviewPage = lazyPage(() => import("./InterviewPage"));
export const AnalyticsPage = lazyPage(() => import("./AnalyticsPage"));
export const SettingsPage = lazyPage(() => import("./SettingsPage"));
export const TrashPage = lazyPage(() => import("./TrashPage"));
