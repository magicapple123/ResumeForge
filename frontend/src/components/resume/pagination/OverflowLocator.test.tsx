// SPDX-License-Identifier: Apache-2.0
/** 溢出定位：报告状态、页数/溢出、第一条未显示内容、手动断页定位。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { parsePaginationReport } from "../../../features/resume-pagination/paginationReport";
import OverflowLocator from "./OverflowLocator";

const RAW = {
  pages: 2,
  pages_needed: 3,
  page_limit: 2,
  overflow: true,
  truncated_at: {
    kind: "entry",
    section: "projects",
    object_id: "prj_12345678",
    text_preview: "Led migration",
  },
  manual_breaks: [{ kind: "section", section: "experience", page: 2 }],
  warnings: [{ code: "repeat_name_no_room", detail: "top margin too small" }],
  snapshot: { content_sha256: "c1", render_config_sha256: "r1" },
};

function renderLocator(props: Partial<ComponentProps<typeof OverflowLocator>> = {}) {
  render(
    <AntdApp>
      <OverflowLocator report={null} {...props} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("OverflowLocator", () => {
  it("没有报告时显示空态，刷新按钮回传宿主", () => {
    const onRefresh = vi.fn();
    renderLocator({ onRefresh });
    expect(screen.getByText(t("pagination.report.empty"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("pagination.report.refresh") }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("失败态给出错误与重试", () => {
    const onRefresh = vi.fn();
    renderLocator({ error: "boom", onRefresh });
    expect(screen.getByText(t("pagination.report.failed"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("pagination.report.retry") }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("展示真实页数/溢出/第一条未显示内容，定位回传对象目标", () => {
    const onLocate = vi.fn();
    const report = parsePaginationReport(RAW);
    renderLocator({ report, onLocate, sectionLabels: { projects: "Projects" } });
    expect(
      screen.getByText(t("pagination.report.pages", { pages: 3, limit: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("pagination.report.overflow"))).toBeInTheDocument();
    expect(
      screen.getByText(t("pagination.report.truncated", { preview: "Led migration" })),
    ).toBeInTheDocument();
    const locateButtons = screen.getAllByRole("button", { name: t("pagination.report.locate") });
    fireEvent.click(locateButtons[0]);
    expect(onLocate).toHaveBeenCalledWith({
      objectId: "prj_12345678",
      section: "projects",
    });
  });

  it("手动断页：按页号定位（宿主接 PageNavigator）", () => {
    const onLocate = vi.fn();
    const report = parsePaginationReport(RAW);
    renderLocator({ report, onLocate, sectionLabels: { experience: "Experience" } });
    expect(
      screen.getByText(t("pagination.report.manualBreak", { page: 2, name: "Experience" })),
    ).toBeInTheDocument();
    const locateButtons = screen.getAllByRole("button", { name: t("pagination.report.locate") });
    fireEvent.click(locateButtons[locateButtons.length - 1]);
    expect(onLocate).toHaveBeenCalledWith({ section: "experience", page: 2 });
  });

  it("过期快照如实提示；没有 onLocate 时定位按钮禁用", () => {
    const report = parsePaginationReport(RAW);
    renderLocator({ report, stale: true });
    expect(screen.getByText(t("pagination.report.stale"))).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: t("pagination.report.locate") })) {
      expect(button).toBeDisabled();
    }
  });
});
