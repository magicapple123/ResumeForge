// SPDX-License-Identifier: Apache-2.0
/**
 * W08-INT 组合证据：**report 取数 → OverflowLocator 定位 → 页标记**整条链在宿主胶水层
 * 已经能跑通（等 wb-core 把 OverflowLocator 挂进画布工具条时，宿主只需照抄这个组合）。
 *
 * 不启动后端：fetcher 注入真实响应的**同一形状**（backend document_pagination.py，
 * 由 tests/test_pagination_report.py 断言）；真实端点本身由后端测试覆盖。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type {
  LocateTarget,
  PaginationReport,
} from "../../../features/resume-pagination/paginationReport";
import { parsePaginationReport } from "../../../features/resume-pagination/paginationReport";
import { usePaginationReport } from "../../../features/resume-pagination/usePaginationReport";
import {
  createReportMarkersStore,
  usePaginationReportMarkers,
} from "../../../features/resume-pagination/paginationPageMarkers";
import OverflowLocator from "./OverflowLocator";

const REPORT = parsePaginationReport({
  pages: 1,
  pages_needed: 2,
  overflow: true,
  page_limit: 1,
  truncated_at: {
    kind: "entry",
    section: "experience",
    object_id: "exp_12345678",
    point_index: null,
    text_preview: "Led payment refactor",
  },
  manual_breaks: [{ kind: "entry", object_id: "exp_12345678", page: 2 }],
  warnings: [],
  snapshot: { content_sha256: "a".repeat(64), render_config_sha256: "b".repeat(64) },
}) as PaginationReport;

function Harness({
  fetcher,
  onLocate,
}: {
  fetcher: () => Promise<PaginationReport>;
  onLocate: (target: LocateTarget) => void;
}) {
  const [store] = useState(() => createReportMarkersStore());
  const pagination = usePaginationReport({
    resumeId: 7,
    buildRequest: () => ({
      template: "classic",
      page_limit: 1,
      format_config: {
        pagination: { version: 1, entries: { exp_12345678: { break_before: "page" } } },
      },
    }),
    fetcher: fetcher as never,
  });
  usePaginationReportMarkers(pagination.report, store);
  return (
    <AntdApp>
      <OverflowLocator
        report={pagination.report}
        loading={pagination.loading}
        error={pagination.error || null}
        onRefresh={() => void pagination.run()}
        onLocate={onLocate}
        sectionLabels={{ experience: "Experience" }}
      />
    </AntdApp>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("W08-INT 组合：report → 定位 → 页标记", () => {
  it("点「获取分页报告」→ 展示真实结构 → 定位回传语义目标", async () => {
    const fetcher = vi.fn(async () => REPORT);
    const onLocate = vi.fn();
    render(<Harness fetcher={fetcher} onLocate={onLocate} />);
    fireEvent.click(screen.getByRole("button", { name: t("pagination.report.refresh") }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(t("pagination.report.pages", { pages: 2, limit: 1 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("pagination.report.truncated", { preview: "Led payment refactor" })),
    ).toBeInTheDocument();
    const locateButtons = screen.getAllByRole("button", {
      name: t("pagination.report.locate"),
    });
    fireEvent.click(locateButtons[0]);
    expect(onLocate).toHaveBeenCalledWith({ objectId: "exp_12345678", section: "experience" });
  });

  it("报告写入页标记 store（blocker 落上限页），清空后标记消失", async () => {
    const store = createReportMarkersStore();
    function MarkerHarness() {
      const pagination = usePaginationReport({
        resumeId: 7,
        buildRequest: () => ({ template: "classic" }),
        fetcher: (async () => REPORT) as never,
      });
      usePaginationReportMarkers(pagination.report, store);
      return (
        <AntdApp>
          <OverflowLocator
            report={pagination.report}
            loading={pagination.loading}
            error={null}
            onRefresh={() => void pagination.run()}
          />
        </AntdApp>
      );
    }
    render(<MarkerHarness />);
    fireEvent.click(screen.getByRole("button", { name: t("pagination.report.refresh") }));
    await waitFor(() =>
      expect(store.getSnapshot()).toEqual([{ page: 1, severity: "blocker", count: 1 }]),
    );
    cleanup();
    expect(store.getSnapshot()).toEqual([]);
  });
});
