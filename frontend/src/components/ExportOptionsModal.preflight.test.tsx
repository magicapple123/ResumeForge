// SPDX-License-Identifier: Apache-2.0
/**
 * 导出前的预检闸门（2026-11 问题 3）：超页必须问一句，且数字要具体。
 *
 * 四条验收：
 * 1. 有 blocker → 出现二次确认、文案带具体页数，选「先调整」不导出；
 * 2. 有 blocker + 「仍然导出」→ 导出被调用一次，同一读数不再问第二次；
 * 3. 无 blocker → 不打断，直接导出；
 * 4. 预检失败（500 / 网络断）→ 放行，导出照常。
 *
 * 另外钉住"只在点导出时才发预检"：打开面板不发请求。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { t } from "../i18n";
import { makeIssue, makePreflightOut, makeSnapshot } from "../test/preflightFixtures";
import ExportOptionsModal from "./ExportOptionsModal";

const apiMocks = vi.hoisted(() => ({ exportResumeWithOptions: vi.fn() }));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  printHtml: vi.fn(),
}));

const preflightMocks = vi.hoisted(() => ({ runPreflight: vi.fn() }));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);
vi.mock("../features/resume-preflight/preflightApi", () => preflightMocks);

const RESULT = { blob: new Blob(["x"]), filename: "简历.pdf", pages: null, pageLimit: null };

/** 上溢：内容需要 3 页、上限 2 页（`pages_needed` 来自 fix.payload，与后端同形）。 */
const OVERFLOW = makePreflightOut({
  snapshot: makeSnapshot({ page_limit: 2 }),
  issues: [
    makeIssue({
      layer: "product",
      severity: "blocker",
      code: "product_pdf_overflow",
      title_key: "preflight.issue.product_pdf_overflow",
      locator: { scope: "export", page: 2 },
      fix: {
        action: "add_page",
        payload: { pages_needed: 3 },
        label_key: "preflight.fix.add_page",
      },
    }),
  ],
  summary: { blocker: 1, verify: 0, suggestion: 0 },
});

const CLEAN = makePreflightOut();

function renderModal(props: { initialPageLimit?: number } = {}) {
  return render(
    <AntdApp>
      <ExportOptionsModal recordId={7} open onClose={vi.fn()} {...props} />
    </AntdApp>,
  );
}

function clickExport() {
  fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));
}

beforeEach(() => {
  apiMocks.exportResumeWithOptions.mockReset().mockResolvedValue(RESULT);
  downloadMocks.downloadBlob.mockReset();
  downloadMocks.printHtml.mockReset();
  preflightMocks.runPreflight.mockReset().mockResolvedValue(CLEAN);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("导出前预检闸门", () => {
  it("打开面板不发预检：只有点导出才请求", () => {
    renderModal({ initialPageLimit: 2 });

    expect(preflightMocks.runPreflight).not.toHaveBeenCalled();
  });

  it("超页时问一次，文案带具体页数；选「先调整」不调用导出", async () => {
    preflightMocks.runPreflight.mockResolvedValue(OVERFLOW);
    renderModal({ initialPageLimit: 2 });

    clickExport();

    const alert = await screen.findByRole("alert");
    // 三个数字都必须在文案里：需要 3 页、上限 2 页、第 3 页起不导出。
    expect(alert.textContent).toContain(
      t("exportPanel.preflight.overflowTitle", { pages: 3, limit: 2 }),
    );
    expect(alert.textContent).toContain(
      t("exportPanel.preflight.overflowBody", { next: 3, pages: 3, limit: 2 }),
    );

    // 预检请求带的是预览的版式草稿（页数上限必须与导出同一份）。
    expect(preflightMocks.runPreflight).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        layers: ["product"],
        layout: expect.objectContaining({ page_limit: 2 }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: t("exportPanel.preflight.adjustFirst") }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(apiMocks.exportResumeWithOptions).not.toHaveBeenCalled();
    expect(downloadMocks.downloadBlob).not.toHaveBeenCalled();
  });

  it("选「仍然导出」后照常导出一次，同一读数不再问第二次", async () => {
    preflightMocks.runPreflight.mockResolvedValue(OVERFLOW);
    renderModal({ initialPageLimit: 2 });

    clickExport();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: t("exportPanel.preflight.exportAnyway") }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(1);

    // 再点一次导出：同一份读数已经确认过，不再打断。
    clickExport();
    await waitFor(() => expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: t("exportPanel.preflight.exportAnyway") }),
    ).toBeNull();
  });

  it("没有 blocker 时不打断：导出直接走", async () => {
    renderModal({ initialPageLimit: 2 });

    clickExport();

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: t("exportPanel.preflight.exportAnyway") }),
    ).toBeNull();
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(1);
  });

  it("预检失败时放行：导出照常，不因为检查挂了就导不出来", async () => {
    preflightMocks.runPreflight.mockRejectedValue(new ApiError("boom", 500));
    renderModal({ initialPageLimit: 2 });

    clickExport();

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: t("exportPanel.preflight.exportAnyway") }),
    ).toBeNull();
  });
});
