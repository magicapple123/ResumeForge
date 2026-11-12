// SPDX-License-Identifier: Apache-2.0
/**
 * 分页报告的**模块级只读快照**：W08 请求方（`usePaginationReport` 的宿主）与消费方
 * （`PaginationControls` 里的页缩略图）不在同一个 props 链上——宿主在画布横幅/左栏以外，
 * 缩略图挂在左栏分页面板内部。走 store 后，夹在 `PaginationControls` 里的缩略图**无需
 * shell 传参**即可跟随"获取分页报告"更新（不新增 shell 契约）。
 *
 * 生命周期与页标记完全一致：`usePaginationReportMarkers` 在报告变化时写入、卸载时清空。
 */
import { useSyncExternalStore } from "react";
import type { PaginationReport } from "./paginationReport";

export interface PaginationReportStore {
  getSnapshot: () => PaginationReport | null;
  subscribe: (listener: () => void) => () => void;
  set: (report: PaginationReport | null) => void;
}

export function createPaginationReportStore(
  initial: PaginationReport | null = null,
): PaginationReportStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (report) => {
      snapshot = report;
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/** 应用级单例：W08 写入、页缩略图订阅。 */
export const paginationReportStore = createPaginationReportStore();

/** 订阅当前分页报告（没有时返回 null）。 */
export function usePaginationReportSnapshot(): PaginationReport | null {
  return useSyncExternalStore(
    paginationReportStore.subscribe,
    paginationReportStore.getSnapshot,
    paginationReportStore.getSnapshot,
  );
}

/** 写入/清空（`null` = 清空）。 */
export function syncPaginationReport(report: PaginationReport | null): void {
  paginationReportStore.set(report);
}

/** 测试清理：与 `resetPageMarkers` 成对使用。 */
export function resetPaginationReport(): void {
  paginationReportStore.set(null);
}
