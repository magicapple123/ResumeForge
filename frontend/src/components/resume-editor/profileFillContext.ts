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
  /**
   * 是否在每个**条目**的头部渲染「从资料填入本条」。
   *
   * 为什么需要这个开关：岗位详情里的「自行编写简历」拿到的是**空白**的经历/项目列表，
   * 用户要的是"照着这个岗位从头写"，条目是他自己一条条加出来的——每条头部再摆一个
   * "填入本条"既没有可用目标（条目不来自资料），也和顶部「从我的资料追加一条」抢同一
   * 件事。顶部的追加入口不受它影响（那才是这个场景下唯一需要的入口）。
   *
   * 缺省（`undefined`）视为 `true`：既有的通用手写简历、资料页编辑都要保留条目级入口。
   */
  entryFill: boolean;
}

const ProfileFillContext = createContext<ProfileFillContextValue | null>(null);

export const ProfileFillProvider = ProfileFillContext.Provider;

/** 取候选；没提供时返回 `null`，调用方据此完全不渲染入口。 */
export function useProfileFill(): ProfileFillContextValue | null {
  return useContext(ProfileFillContext);
}
