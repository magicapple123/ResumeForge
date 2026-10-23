// SPDX-License-Identifier: Apache-2.0
import { lazy } from "react";

/**
 * 外壳级弹层（不进路由表，但同样要懒加载）。
 *
 * 与 `registry.ts` 分开只是为了让"导航预热表"与"路由表"读同一份清单时不被无关的
 * 弹层污染——使用指南有 8 步内容，没必要随首屏预热一起拉下来。
 */
export const UserGuideModal = lazy(() => import("../components/UserGuideModal"));
