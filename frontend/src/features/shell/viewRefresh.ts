// SPDX-License-Identifier: Apache-2.0
/**
 * 「当前视图重新取数」的跨组件广播（P5-1 / P5-3 / 13-1·13-3）。
 *
 * 问题：品牌图标双击要"刷新这一页的数据"，但页面数据分散在几十处 `useApi` 调用里，
 * 谁也不认识谁；最省事的实现 `location.reload()` 会把路由、滚动位置、未保存草稿、
 * 后台任务进度一起丢掉——那是重开应用，不是刷新。
 *
 * 做法与 `features/resume/resumeListEvents.ts` 完全同构：发起方 `requestViewRefresh()`
 * 广播一个递增版本号，订阅方（`hooks/useApi.ts`）版本变了就重取。发起方不需要知道
 * "有谁在看"，订阅方也不需要知道"是谁让我刷的"。
 *
 * 快照就是一个 `number`：天然引用稳定，`useSyncExternalStore` 不会因为"每次返回新对象"
 * 而无限重渲染。
 *
 * 两个刻意的边界：
 * 1. **只广播、不判断**——"要不要重取"由每个订阅点自己决定（有未保存草稿的编辑器 hook
 *    传 `refreshOnRequest: false`，见 `useApi` 的同名选项）；
 * 2. 单个订阅者抛错不连累其它页面（与 `hooks/focusRefresh.ts` 同一套约定）。
 */
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

/** 请求"当前视图重新取数"（品牌图标双击 / Alt+R）。 */
export function requestViewRefresh(): void {
  version += 1;
  // 快照遍历：订阅者在回调里退订不会让本轮漏掉其他人。
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // 一个页面刷新失败不该让别的页面也不刷新。
    }
  }
}

/** 订阅广播；返回退订函数。订阅时**不会**立刻回调（首屏请求由 `useApi` 自己负责）。 */
export function subscribeViewRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前版本号（`useSyncExternalStore` 的快照）。 */
export function getViewRefreshVersion(): number {
  return version;
}

/** 订阅版本号的 React 入口。 */
export function useViewRefreshVersion(): number {
  return useSyncExternalStore(subscribeViewRefresh, getViewRefreshVersion, getViewRefreshVersion);
}

/** 测试用：版本归零并清掉订阅者（单例 store 的用例之间必须复位）。 */
export function resetViewRefreshForTests(): void {
  version = 0;
  listeners.clear();
}
