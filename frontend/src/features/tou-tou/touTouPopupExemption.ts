// SPDX-License-Identifier: Apache-2.0
/**
 * 投投浮窗的「弹层焦点豁免」信号（T11）；与 Provider 分开，避免热更新把非组件导出
 * 当成组件模块（与 `touTouContext.ts` 同一个理由）。
 *
 * ## 解决什么
 *
 * `antd` 的 Modal 开焦点陷阱时，焦点只要不在被锁的弹窗子树里就被拉回关闭按钮。
 * 卡片本体由 `touTouCardGuards.ts` 豁免（`TOU_TOU_CARD_SELECTOR`），但卡片里
 * **portal 到 body 的浮层**不在卡片子树内 —— 典型就是 `+` 面板（antd `Dropdown`）
 * 以及面板里岗位 / 简历那两个 `showSearch` 远程搜索的输入框与下拉。输入框一聚焦
 * 就被抢走，一个字打不进。
 *
 * ## 为什么是 Context 而不是逐层 prop
 *
 * 标记只该由卡片这一侧的渲染树决定，而在当前结构里卡片**并不直接渲染**
 * `AssistantComposer`：`TouTouAssistantCard` 的 `children` 是 `AppShell` 里创建的
 * `<AssistantPage compact surface="floating">`，中间的 `AssistantPage` /
 * `AssistantPageProps` 都在别的文件里。为传一个布尔量去改三处，是把耦合面放大；
 * `compact` 也不能当判据（窄屏的页面形态同样传 `compact`，见 `routes` 侧的用法）。
 * 所以卡片自己 provide、`AddMenu` 自己 consume，默认 `false`：页面内的同款控件
 * 不带标记，照旧被焦点陷阱接管。
 *
 * ## 边界
 *
 * 只把 `tt-popup-exempt` 挂到**卡片自己那些浮层**上（`+` 面板 / 它的下拉）。
 * 不要在全局 `ConfigProvider`、页面级 composer 或任意 popup 上挂。
 */

import { createContext, useContext } from "react";

/**
 * 默认 `false`：没有 Provider 的渲染树（页面内 composer、单测里的裸渲染）一律不豁免。
 */
export const TouTouPopupExemptionContext = createContext<boolean>(false);

/** 当前渲染树是否处在投投浮窗里（决定要不要给浮层挂 `tt-popup-exempt`）。 */
export function useTouTouPopupExemption(): boolean {
  return useContext(TouTouPopupExemptionContext);
}
