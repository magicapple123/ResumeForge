// SPDX-License-Identifier: Apache-2.0
/**
 * 分页报告 → **页缩略图数据**（W08：显示实际页数、末页占用与问题/溢出位置）。
 *
 * 纯函数：报告进来、缩略图列表出去。页级问题聚合复用画布侧唯一实现
 * （`pageMarkersForReport` → `features/resume-proview/pageMarkers`），避免"缩略图上的红点"
 * 与"页导航上的红点"各算一套。
 *
 * ## 末页占用为什么可能是 null
 *
 * 后端 `pagination/report` 当前只回 pages/pages_needed/overflow/truncated_at 等，没有
 * 逐页内容高度。前端不猜：报告没给 `last_page_fill` 就显示"未测量"；溢出且报告没给时
 * 由调用方显示"已截断（末页满）"——那是从 overflow 得出的**确定事实**，不是估算百分比。
 */
import type { PaginationReport, PaginationWarning } from "./paginationReport";
import { pageMarkersForReport } from "./paginationPageMarkers";
import type { PageMarkerSeverity } from "../resume-proview/pageMarkers";

export interface PageThumbnailIssue {
  severity: PageMarkerSeverity;
  count: number;
}

export interface PageThumbnail {
  /** 页码（1 起）。 */
  page: number;
  isLast: boolean;
  /** 末页占用（0–1）；只有末页且报告提供时才有值。 */
  fill: number | null;
  /** 这一页就是被页数上限截断的位置（blocker）。 */
  truncated: boolean;
  /** 有手动"从新页开始"落在这页（信息性质）。 */
  manualBreak: boolean;
  /** 这一页上的问题聚合（严重度取该页最重；count 累加）。 */
  issue: PageThumbnailIssue | null;
}

export interface PageThumbnailModel {
  /** 没有报告时为空数组（页面显示空态，不编页数）。 */
  pages: PageThumbnail[];
  totalPages: number;
  pagesNeeded: number | null;
  pageLimit: number | null;
  overflow: boolean;
  lastPageFill: number | null;
  /** 全局注意事项（续页姓名放不下等，不属于某一页）。 */
  warnings: PaginationWarning[];
  /** 有报告才为 true（页面据此区分"还没测量"与"测出来 0 页"）。 */
  measured: boolean;
}

const EMPTY: PageThumbnailModel = {
  pages: [],
  totalPages: 0,
  pagesNeeded: null,
  pageLimit: null,
  overflow: false,
  lastPageFill: null,
  warnings: [],
  measured: false,
};

/** 把报告铺成 1..pages 的缩略图列表；页数上限内的页标记来自唯一聚合实现。 */
export function buildPageThumbnails(
  report: PaginationReport | null | undefined,
): PageThumbnailModel {
  if (!report) return { ...EMPTY, pages: [] };
  const totalPages = Math.max(0, Math.trunc(report.pages ?? 0));
  const markers = pageMarkersForReport(report);
  const markerByPage = new Map(markers.map((marker) => [marker.page, marker]));
  const manualPages = new Set(
    report.manualBreaks
      .map((item) => item.page)
      .filter((page): page is number => typeof page === "number"),
  );
  const pages: PageThumbnail[] = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const marker = markerByPage.get(page);
    pages.push({
      page,
      isLast: page === totalPages,
      fill: page === totalPages ? report.lastPageFill : null,
      truncated: marker?.severity === "blocker",
      manualBreak: manualPages.has(page),
      issue: marker ? { severity: marker.severity, count: marker.count } : null,
    });
  }
  return {
    pages,
    totalPages,
    pagesNeeded: report.pagesNeeded,
    pageLimit: report.pageLimit,
    overflow: report.overflow,
    lastPageFill: report.lastPageFill,
    warnings: report.warnings,
    measured: true,
  };
}

/** 末页占用的人话：有实测值给比例；溢出说明"已满（截断）"；否则明确"未测量"。 */
export type LastPageFillLabel =
  { kind: "ratio"; ratio: number } | { kind: "truncated" } | { kind: "unknown" };

export function lastPageFillLabel(model: PageThumbnailModel): LastPageFillLabel {
  if (model.lastPageFill !== null) return { kind: "ratio", ratio: model.lastPageFill };
  if (model.overflow) return { kind: "truncated" };
  return { kind: "unknown" };
}

/** 占用比例 → 整数百分比（四舍五入到 1%，夹在 0–100）。 */
export function fillPercent(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}
