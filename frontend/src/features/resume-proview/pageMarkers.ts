// SPDX-License-Identifier: Apache-2.0
/**
 * 页导航上的"问题位置"标记（W08 溢出定位 → D04 页导航，fe-layout 与 fe-delivery 的接口）。
 *
 * 为什么是模块级小 store 而不是 Provider：标记是**视图态**，生产方（W08 分页面板）与
 * 消费方（画布工具条）不在同一 React 子树（一个由 shell 挂、一个在 ResumePreview 上方），
 * 走 Provider 需要 shell 多传一条 prop；而它不需要持久化、也不需要跨文档同步。
 *
 * 生命周期：W08 在挂载/数据变化时 `set`，卸载时 `set([])`；画布侧的 PageNavigator 只
 * 渲染页码在 `1..totalPages` 内的标记（超出范围的旧数据自动忽略）。
 */
import { useSyncExternalStore } from "react";

export type PageMarkerSeverity = "blocker" | "verify" | "suggestion";

export interface PageMarker {
  /** 页码（1 起）。 */
  page: number;
  severity: PageMarkerSeverity;
  /** 这一页上的问题条数。 */
  count: number;
}

export interface PageMarkersStore {
  getSnapshot: () => readonly PageMarker[];
  subscribe: (listener: () => void) => () => void;
  set: (markers: readonly PageMarker[]) => void;
}

const EMPTY: readonly PageMarker[] = [];

/** 创建独立 store（测试用；应用里用下面的单例）。 */
export function createPageMarkersStore(initial: readonly PageMarker[] = EMPTY): PageMarkersStore {
  let snapshot: readonly PageMarker[] = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (markers) => {
      snapshot = markers.length > 0 ? markers.map((marker) => ({ ...marker })) : EMPTY;
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/** 应用级单例：W08 写入、画布工具条订阅。 */
export const pageMarkersStore = createPageMarkersStore();

/** 订阅标记（画布工具条用）。 */
export function usePageMarkers(): readonly PageMarker[] {
  return useSyncExternalStore(
    pageMarkersStore.subscribe,
    pageMarkersStore.getSnapshot,
    pageMarkersStore.getSnapshot,
  );
}

/** 清空（测试清理 / W08 卸载）。 */
export function resetPageMarkers(): void {
  pageMarkersStore.set(EMPTY);
}

// ── W08 pagination/report → 页标记（数据源：be-render 的 report 端点）────────────
//
// POST /resumes/{id}/pagination/report 返回：
//   {pages, pages_needed, overflow, page_limit, truncated_at, manual_breaks, warnings,
//    snapshot{content_sha256, render_config_sha256}}
// 聚合口径（与 be-render 约定）：
// - `truncated_at`（被页数上限截断的位置）= blocker，落在 `page_limit` 页，计 1；
// - `manual_breaks` 每处强制分页 = suggestion（信息性质），各计 1；
// - `warnings`（续页姓名放不下）不属于"对象位置"，不进页标记。
// 同一页多条 → count 累加；severity 取该页最重的一级。

/** report 里每条定位的最小形状（后端已带 object_id/section，前端暂只用 page）。 */
export interface PaginationReportEntry {
  page?: number | null;
  page_limit?: number | null;
  object_id?: string | null;
  section?: string | null;
}

export interface PaginationReportLike {
  page_limit?: number | null;
  truncated_at?: PaginationReportEntry | number | null;
  manual_breaks?: readonly (PaginationReportEntry | number)[];
}

const SEVERITY_RANK: Record<PageMarkerSeverity, number> = {
  blocker: 0,
  verify: 1,
  suggestion: 2,
};

function entryPage(entry: PaginationReportEntry | number, fallback: number | null): number | null {
  if (typeof entry === "number") return entry;
  if (typeof entry.page === "number") return entry.page;
  return fallback;
}

/**
 * 把 pagination/report 聚合成页导航的标记（W08-FE 在拿到 report 后一行调用即可：
 * `pageMarkersStore.set(pageMarkersFromPaginationReport(report))`）。
 *
 * 页码超出 1..page_limit 的条目自动忽略（与 PageNavigator 的越界过滤同口径）。
 */
export function pageMarkersFromPaginationReport(
  report: PaginationReportLike | null | undefined,
): PageMarker[] {
  if (!report) return [];
  const pageLimit =
    typeof report.page_limit === "number" && report.page_limit >= 1
      ? Math.round(report.page_limit)
      : null;
  const merged = new Map<number, PageMarker>();
  const push = (page: number | null, severity: PageMarkerSeverity) => {
    if (page === null || !Number.isFinite(page)) return;
    const rounded = Math.round(page);
    if (rounded < 1) return;
    if (pageLimit !== null && rounded > pageLimit) return;
    const existing = merged.get(rounded);
    if (!existing) {
      merged.set(rounded, { page: rounded, severity, count: 1 });
      return;
    }
    existing.count += 1;
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[existing.severity]) {
      existing.severity = severity;
    }
  };
  // truncated_at 可能给对象或直接给页码：对象缺 page 时落在页数上限那一页。
  if (report.truncated_at !== null && report.truncated_at !== undefined) {
    push(entryPage(report.truncated_at, pageLimit), "blocker");
  }
  for (const item of report.manual_breaks ?? []) {
    push(entryPage(item, null), "suggestion");
  }
  return [...merged.values()].sort((left, right) => left.page - right.page);
}
