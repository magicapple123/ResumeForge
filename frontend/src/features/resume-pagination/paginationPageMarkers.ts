// SPDX-License-Identifier: Apache-2.0
/**
 * W08 报告 → 页导航"问题位置"标记的**宿主接线**（唯一聚合实现见 fe-delivery 的
 * `features/resume-proview/pageMarkers.pageMarkersFromPaginationReport`）。
 *
 * 为什么这里只做"薄委托"：
 * - 聚合口径（truncated_at→blocker 落上限页、manual_breaks→suggestion、warnings 不进标记、
 *   同页累加取最重、越界页码忽略）由**画布侧的实现**统一拥有，画布 PageNavigator 也直接消费它；
 * - W08 如果自己再写一份，就会出现"报告页标记在画布上是一套、在别处又是另一套"的漂移
 *   （AGENTS「一处逻辑一份实现」）。本模块只保留 W08 需要的 **hook 生命周期**：
 *   报告变化时写 store、卸载/换文档时清空。
 */
import { useEffect } from "react";
import {
  createPageMarkersStore,
  pageMarkersFromPaginationReport,
  pageMarkersStore,
  type PageMarker,
  type PageMarkersStore,
} from "../resume-proview/pageMarkers";
import type { PaginationReport } from "./paginationReport";
import { syncPaginationReport } from "./paginationReportStore";

/**
 * 报告的驼峰形状 → 画布侧聚合器的输入形状（契约 §3.6 的 snake_case 键）。
 *
 * 这里是**唯一**的字段名适配点：前端解析层统一用驼峰（与现有 TS 代码风格一致），
 * 画布侧聚合器按后端字段名接收；两处只在这一个函数里对接，不各写一份口径。
 */
function toMarkerInput(report: PaginationReport) {
  return {
    page_limit: report.pageLimit,
    truncated_at: report.truncatedAt
      ? {
          section: report.truncatedAt.section,
          object_id: report.truncatedAt.objectId,
        }
      : null,
    manual_breaks: report.manualBreaks.map((item) => ({
      page: item.page,
      object_id: item.objectId,
      section: item.section,
    })),
  };
}

/** 从报告派生页标记（委托唯一实现；纯函数，便于测试）。 */
export function pageMarkersForReport(report: PaginationReport | null): PageMarker[] {
  if (!report) return [];
  return pageMarkersFromPaginationReport(toMarkerInput(report));
}

/** 把报告写进标记 store（`null` = 清空）。 */
export function syncPageMarkers(
  report: PaginationReport | null,
  store: PageMarkersStore = pageMarkersStore,
): void {
  store.set(pageMarkersForReport(report));
}

/** 测试便捷入口：独立 store（应用里用单例 + `syncPageMarkers`）。 */
export function createReportMarkersStore(): PageMarkersStore {
  return createPageMarkersStore();
}

/**
 * 宿主接线：报告变化时写标记，卸载时清空。
 *
 * 生产方（W08 分页面板/宿主）与消费方（画布工具条）不在同一 React 子树，标记只能走既有
 * store；这个 hook 把生命周期收在一处，宿主只需把 `usePaginationReport` 的 report 传进来。
 */
export function usePaginationReportMarkers(
  report: PaginationReport | null,
  store: PageMarkersStore = pageMarkersStore,
): void {
  useEffect(() => {
    syncPageMarkers(report, store);
    // 页缩略图与页标记同一份来源：报告写入即刷新（PaginationControls 内部订阅）。
    syncPaginationReport(report);
    return () => {
      store.set([]);
      syncPaginationReport(null);
    };
  }, [report, store]);
}
