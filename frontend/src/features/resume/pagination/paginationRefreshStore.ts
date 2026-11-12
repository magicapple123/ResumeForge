// SPDX-License-Identifier: Apache-2.0
/**
 * 「获取分页报告」的**动作句柄**注册处：让页缩略图（挂在 `PaginationControls` 内部）
 * 也能触发宿主持有的那次请求。
 *
 * ## 为什么是 store 而不是模块变量
 *
 * 只用一个模块变量的话，注册发生在宿主的 `useEffect` 里，而缩略图组件早已渲染完成——
 * 它**没有任何理由重渲染**，于是按钮会一直停在"禁用"态（用户看到的按钮"点了没反应"）。
 * 走 `useSyncExternalStore` 后，注册/注销都会通知订阅者，按钮的可用态与真实句柄同源。
 *
 * ## 与 `paginationReportStore` 的分工
 *
 * 那个 store 传**数据**（报告快照），这个 store 传**动作**（触发一次测量）。分开是因为
 * 生命周期不同：报告要长期保留给缩略图读，动作句柄随宿主卸载就失效（必须清空，否则
 * 缩略图会握住一个已卸载组件的闭包）。
 */
import { useSyncExternalStore } from "react";

/** 触发一次「获取分页报告」；由宿主（`useWorkbenchContextPanels`）提供。 */
export type PaginationReportRefresh = () => void;

let refreshHandler: PaginationReportRefresh | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PaginationReportRefresh | null {
  return refreshHandler;
}

/** 注册（宿主挂载时）/ 注销（传 `null`，卸载时）。重复注册同一句柄不会触发通知。 */
export function setPaginationReportRefresh(next: PaginationReportRefresh | null): void {
  if (refreshHandler === next) return;
  refreshHandler = next;
  emit();
}

/** 调一次已注册的动作；没注册时什么都不做（按钮本身就是 disabled）。 */
export function triggerPaginationReportRefresh(): void {
  refreshHandler?.();
}

/** 订阅当前动作句柄（没注册时为 `null`）。 */
export function usePaginationReportRefresh(): PaginationReportRefresh | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 测试清理：与 `resetPaginationReport` 成对使用。 */
export function resetPaginationReportRefresh(): void {
  setPaginationReportRefresh(null);
}
