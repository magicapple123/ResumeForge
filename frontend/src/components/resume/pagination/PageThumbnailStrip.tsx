// SPDX-License-Identifier: Apache-2.0
/**
 * W08 页缩略图条：显示**实际页数、末页占用、溢出/手动分页/问题位置**。
 *
 * 数据来源：`usePaginationReport` 写入的模块级快照（见 `paginationReportStore.ts`）。
 * 因此本组件可以挂在 `PaginationControls` 内部而**不需要 shell 传参**——"获取分页报告"
 * 更新报告后缩略图自动跟随；没有报告时如实显示空态（不画假页）。
 *
 * 末页占用：后端目前只在 report 里给 pages/pages_needed/overflow；`last_page_fill`
 * 是可选扩展字段。没有该字段时显示"未测量"；溢出时显示"已截断（满页）"——这是从
 * overflow 得出的确定事实，不是估算百分比。
 */
import { useMemo } from "react";
import { t } from "../../../i18n";
import type { PaginationReport } from "../../../features/resume-pagination/paginationReport";
import {
  buildPageThumbnails,
  fillPercent,
  type PageThumbnail,
  type PageThumbnailModel,
} from "../../../features/resume-pagination/pageThumbnails";
import { usePaginationReportSnapshot } from "../../../features/resume-pagination/paginationReportStore";
import "./pagination.css";

function fillLabel(model: PageThumbnailModel, page: PageThumbnail): string {
  if (!page.isLast) return "";
  if (page.fill !== null) {
    return t("pagination.thumbnails.fill", { percent: fillPercent(page.fill) });
  }
  return t(
    model.overflow ? "pagination.thumbnails.fillTruncated" : "pagination.thumbnails.fillUnknown",
  );
}

function pageAria(page: PageThumbnail): string {
  const parts = [t("pagination.thumbnails.page", { page: page.page })];
  if (page.isLast) parts.push(t("pagination.thumbnails.last"));
  if (page.truncated) parts.push(t("pagination.thumbnails.truncatedBadge"));
  if (page.manualBreak) parts.push(t("pagination.thumbnails.manualBreakBadge"));
  if (page.issue) parts.push(t("pagination.thumbnails.pageIssues", { count: page.issue.count }));
  return parts.join(t("pagination.thumbnails.ariaJoin"));
}

function summary(model: PageThumbnailModel): string {
  if (model.pageLimit === null) {
    return t("pagination.thumbnails.summaryNoLimit", { pages: model.totalPages });
  }
  return t("pagination.thumbnails.summary", {
    pages: model.totalPages,
    limit: model.pageLimit,
  });
}

export interface PageThumbnailStripProps {
  /** 测试/宿主显式传入的报告；缺省订阅模块级快照（应用内的真实来源）。 */
  report?: PaginationReport | null;
}

export default function PageThumbnailStrip({ report }: PageThumbnailStripProps) {
  const stored = usePaginationReportSnapshot();
  const model = useMemo(() => buildPageThumbnails(report ?? stored), [report, stored]);

  return (
    <section className="resume-page-thumbnails" aria-label={t("pagination.thumbnails.title")}>
      <div className="resume-page-thumbnails-head">
        <span className="resume-page-thumbnails-title">{t("pagination.thumbnails.title")}</span>
        {model.measured && model.pages.length > 0 ? (
          <span className="resume-page-thumbnails-summary">{summary(model)}</span>
        ) : null}
      </div>
      {!model.measured || model.pages.length === 0 ? (
        <p className="resume-page-thumbnails-hint">
          {t("pagination.thumbnails.empty")}
          {" · "}
          {t("pagination.thumbnails.hint")}
        </p>
      ) : (
        <>
          <ol className="resume-page-thumbnails-list">
            {model.pages.map((page) => (
              <li
                key={page.page}
                aria-label={pageAria(page)}
                className={[
                  "resume-page-thumbnail",
                  page.isLast ? "is-last" : "",
                  page.truncated ? "is-truncated" : "",
                  page.manualBreak ? "is-manual-break" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="resume-page-thumbnail-index">
                  {t("pagination.thumbnails.page", { page: page.page })}
                </span>
                {page.isLast ? (
                  <span className="resume-page-thumbnail-badge">
                    {t("pagination.thumbnails.last")}
                  </span>
                ) : null}
                {page.isLast ? (
                  <span className="resume-page-thumbnail-fill">{fillLabel(model, page)}</span>
                ) : null}
                {page.truncated ? (
                  <span className="resume-page-thumbnail-badge is-warning">
                    {t("pagination.thumbnails.truncatedBadge")}
                  </span>
                ) : null}
                {page.manualBreak ? (
                  <span className="resume-page-thumbnail-badge">
                    {t("pagination.thumbnails.manualBreakBadge")}
                  </span>
                ) : null}
                {page.issue ? (
                  <span
                    className={
                      "resume-page-thumbnail-issue" +
                      (page.issue.severity === "blocker" ? " is-blocker" : "")
                    }
                  >
                    {t("pagination.thumbnails.issue", { count: page.issue.count })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {model.overflow && model.pagesNeeded !== null && model.pagesNeeded > model.totalPages ? (
            <p className="resume-page-thumbnails-hint">
              {t("pagination.thumbnails.needed", { pages: model.pagesNeeded })}
            </p>
          ) : null}
          {model.warnings.length > 0 ? (
            <p className="resume-page-thumbnails-hint">
              {t("pagination.thumbnails.warnings", { count: model.warnings.length })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
