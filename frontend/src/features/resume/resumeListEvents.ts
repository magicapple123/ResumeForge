/**
 * 简历列表的**跨组件刷新广播**（T12）。
 *
 * 问题：手写简历保存成功后，几个宿主各自的列表不会更新——「我的资料」里的通用简历
 * 区块只在挂载时拉一次；简历中心是靠"关弹窗就 reload"，于是**取消也白跑一次请求**。
 * 更糟的是新入口（以后可能还有别处）根本不知道该刷新谁。
 *
 * 做法：保存成功的一方 `bumpResumeList()` 广播一个递增版本号，所有列表订阅它、版本变了
 * 就重取。列表不需要知道"是谁保存的"，保存方也不需要知道"有谁在看"。
 *
 * 快照就是一个 `number`：天然引用稳定，`useSyncExternalStore` 不会因为"每次返回新对象"
 * 而无限重渲染。
 */
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

/** 简历列表发生了变化（新增/删除/改名）：通知所有订阅者重取。 */
export function bumpResumeList(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** 订阅变化；返回取消订阅函数。 */
export function subscribeResumeList(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前版本号（`useSyncExternalStore` 的快照）。 */
export function getResumeListVersion(): number {
  return version;
}

/** 订阅版本号的 React 入口。 */
export function useResumeListVersion(): number {
  return useSyncExternalStore(subscribeResumeList, getResumeListVersion, getResumeListVersion);
}

/** 测试用：版本归零并清掉订阅者（单例 store 的用例之间必须复位）。 */
export function resetResumeListEventsForTests(): void {
  version = 0;
  listeners.clear();
}
