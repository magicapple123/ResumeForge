// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料填入」的 React 上下文。
 *
 * **为什么要上下文而不是一层层传 props**：候选数据由 `ResumeEditorModal` 拿到（它知道
 * 当前打开的是哪份资料的编辑），而真正用它的是深层的 `ResumeListSection`（每个 Tab 里
 * 每个模块各一个）。中间隔着 Tabs / Row / Form.Item 好几层，逐个透传只会让这些本来
 * 与资料无关的组件都长出一个 `fillSources` 参数。
 *
 * 约定：**没提供 Provider 就不渲染入口**（`ResumeDetailPreview` 的编辑入口不传候选，
 * 那时用户改的是已保存简历，从资料里"再填一条"并不是他要做的事）。
 */

import { createContext, useContext } from "react";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";

export interface ProfileFillContextValue {
  sources: ProfileFillSources;
  /** 填入一条之后通知宿主：标记"有未保存的修改"（未保存守卫要看得见它）。 */
  onFilled: () => void;
}

const ProfileFillContext = createContext<ProfileFillContextValue | null>(null);

export const ProfileFillProvider = ProfileFillContext.Provider;

/** 取候选；没提供时返回 `null`，调用方据此完全不渲染入口。 */
export function useProfileFill(): ProfileFillContextValue | null {
  return useContext(ProfileFillContext);
}
