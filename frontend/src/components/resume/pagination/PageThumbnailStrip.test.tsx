// SPDX-License-Identifier: Apache-2.0
/** W08 页缩略图组件：空态、末页占用、溢出/手动分页标记、报告快照订阅、就地取报告。 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { parsePaginationReport } from "../../../features/resume-pagination/paginationReport";
import {
  resetPaginationReport,
  syncPaginationReport,
} from "../../../features/resume-pagination/paginationReportStore";
import {
  resetPaginationReportRefresh,
  setPaginationReportRefresh,
} from "../../../features/resume-pagination/paginationRefreshStore";
import PageThumbnailStrip from "./PageThumbnailStrip";

const REPORT = parsePaginationReport({
  pages: 2,
  pages_needed: 2,
  overflow: false,
  page_limit: 3,
  last_page_fill: 0.62,
  truncated_at: null,
  manual_breaks: [],
  warnings: [],
  snapshot: { content_sha256: "a".repeat(64), render_config_sha256: "b".repeat(64) },
});

const OVERFLOW = parsePaginationReport({
  pages: 1,
  pages_needed: 2,
  overflow: true,
  page_limit: 1,
  truncated_at: {
    kind: "entry",
    section: "experience",
    object_id: "e2e_entry001",
    point_index: null,
    text_preview: "Core pipeline",
  },
  manual_breaks: [{ kind: "section", section: "projects", object_id: null, page: 1 }],
  warnings: [{ code: "repeat_name_no_room", detail: "上边距过小" }],
  snapshot: { content_sha256: "a".repeat(64), render_config_sha256: "b".repeat(64) },
});

function renderStrip(report?: ReturnType<typeof parsePaginationReport>) {
  return render(
    <AntdApp>
      <PageThumbnailStrip report={report} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetPaginationReport();
  resetPaginationReportRefresh();
});

describe("PageThumbnailStrip", () => {
  it("没有报告：如实显示空态与指引，不编页数；取报告按钮在没注册动作时禁用", () => {
    renderStrip(null);
    expect(screen.getByText(t("pagination.thumbnails.title"))).toBeInTheDocument();
    const hint = document.querySelector(".resume-page-thumbnails-hint")?.textContent ?? "";
    expect(hint).toContain(t("pagination.thumbnails.empty"));
    expect(hint).toContain(t("pagination.thumbnails.hint"));
    expect(
      screen.getByRole("button", { name: t("pagination.thumbnails.refresh") }),
    ).toBeDisabled();
  });

  it("空态里点「获取分页报告」触发行人注册的动作（不必回画布顶部找）", () => {
    const run = vi.fn();
    renderStrip(null);
    const button = () => screen.getByRole("button", { name: t("pagination.thumbnails.refresh") });
    expect(button()).toBeDisabled();

    act(() => setPaginationReportRefresh(run));
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("已有报告时在标题行右侧也给同一个取报告按钮", () => {
    const run = vi.fn();
    renderStrip(REPORT);
    act(() => setPaginationReportRefresh(run));
    const head = document.querySelector(".resume-page-thumbnails-head") as HTMLElement;
    fireEvent.click(
      within(head).getByRole("button", { name: t("pagination.thumbnails.refresh") }),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("注销动作后按钮回到禁用（宿主卸载不会留下死句柄）", () => {
    const run = vi.fn();
    renderStrip(null);
    const button = () => screen.getByRole("button", { name: t("pagination.thumbnails.refresh") });
    act(() => setPaginationReportRefresh(run));
    expect(button()).toBeEnabled();
    act(() => setPaginationReportRefresh(null));
    expect(button()).toBeDisabled();
    fireEvent.click(button());
    expect(run).not.toHaveBeenCalled();
  });

  it("多页：逐页渲染、末页标出占用百分比", () => {
    renderStrip(REPORT);
    const pages = screen.getAllByRole("listitem");
    expect(pages).toHaveLength(2);
    expect(pages[1].textContent).toContain(t("pagination.thumbnails.last"));
    expect(screen.getByText(t("pagination.thumbnails.fill", { percent: 62 }))).toBeInTheDocument();
    expect(
      screen.getByText(t("pagination.thumbnails.summary", { pages: 2, limit: 3 })),
    ).toBeInTheDocument();
  });

  it("溢出：截断页有「溢出」标记；末页占用按确定事实显示已截断", () => {
    renderStrip(OVERFLOW);
    const page = screen.getByRole("listitem", {
      name: new RegExp(
        `${t("pagination.thumbnails.page", { page: 1 })}.*${t("pagination.thumbnails.truncatedBadge")}`,
      ),
    });
    expect(page).toBeInTheDocument();
    expect(screen.getByText(t("pagination.thumbnails.fillTruncated"))).toBeInTheDocument();
    expect(screen.getByText(t("pagination.thumbnails.manualBreakBadge"))).toBeInTheDocument();
    expect(screen.getByText(t("pagination.thumbnails.warnings", { count: 1 }))).toBeInTheDocument();
  });

  it("订阅 W08 报告快照：不传报告时，store 更新后缩略图出现", () => {
    renderStrip(undefined);
    expect(document.querySelector(".resume-page-thumbnails-hint")?.textContent).toContain(
      t("pagination.thumbnails.empty"),
    );
    act(() => syncPaginationReport(REPORT));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    act(() => resetPaginationReport());
    expect(document.querySelector(".resume-page-thumbnails-hint")?.textContent).toContain(
      t("pagination.thumbnails.empty"),
    );
  });
});
