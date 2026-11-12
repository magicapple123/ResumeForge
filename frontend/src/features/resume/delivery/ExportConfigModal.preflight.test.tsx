// SPDX-License-Identifier: Apache-2.0
/**
 * W19 交付弹层的导出闸门（问题 3 主路径）：已保存简历从这里导出也必须先预检。
 *
 * 五条验收：
 * 1. 选中 pdf + 超页 blocker → 确认条带具体数字，选「先调整」不导出；
 * 2. 选「仍然导出」→ 交付包导出一次，同一读数不再问第二次；
 * 3. 无 blocker → 不打断，直接导出；
 * 4. 只选 md（没有 pdf/docx）→ 不发预检，直接导出；
 * 5. 预检失败（500）→ 放行，导出照常。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { createMockExportDeliveryApi } from "./index";
import { makeIssue, makePreflightOut, makeSnapshot } from "../../../test/preflightFixtures";
import { makeResumeDocument } from "../../../test/documentHarness";
import ExportConfigModal from "./ExportConfigModal";

const apiMocks = vi.hoisted(() => ({ exportResumeWithOptions: vi.fn() }));
const downloadMocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
const preflightMocks = vi.hoisted(() => ({ runPreflight: vi.fn() }));

vi.mock("../../../api/resumes", () => apiMocks);
vi.mock("../../../utils/download", () => downloadMocks);
vi.mock("../preflight/preflightApi", () => preflightMocks);

const CONTENT = makeResumeDocument();

/** 上溢：内容需要 3 页、上限 2 页（字段形状与后端 preflight_rules_product 同形）。 */
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

function renderModal() {
  const api = createMockExportDeliveryApi({
    content: CONTENT,
    company: "甲公司",
    jobTitle: "后端工程师",
    resumeTitle: "后端简历",
    currentRevision: 3,
  });
  render(
    <AntdApp>
      <ExportConfigModal
        open
        onClose={vi.fn()}
        api={api}
        resumeId={3}
        content={CONTENT}
        revision={3}
        resumeTitle="后端简历"
        company="甲公司"
        jobTitle="后端工程师"
        template="classic"
        language="zh-CN"
        pageLimit={2}
      />
    </AntdApp>,
  );
  return api;
}

/** 点「导出交付包」（按钮文案带空白差异，与既有测试同一套转义）。 */
function clickExport() {
  const label = t("delivery.export.action");
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(escaped.split("").join("\\s*")) }));
}

beforeEach(() => {
  apiMocks.exportResumeWithOptions.mockReset();
  downloadMocks.downloadBlob.mockReset();
  preflightMocks.runPreflight.mockReset().mockResolvedValue(CLEAN);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("交付弹层导出闸门", () => {
  it("超页时问一次，文案带具体页数；选「先调整」不导出", async () => {
    preflightMocks.runPreflight.mockResolvedValue(OVERFLOW);
    const api = renderModal();

    clickExport();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      t("exportPanel.preflight.overflowTitle", { pages: 3, limit: 2 }),
    );
    expect(alert.textContent).toContain(
      t("exportPanel.preflight.overflowBody", { next: 3, pages: 3, limit: 2 }),
    );
    // 预检带的是与导出同一份草稿版式（页数上限 2）。
    expect(preflightMocks.runPreflight).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        layers: ["product"],
        product_formats: ["pdf"],
        layout: expect.objectContaining({ page_limit: 2 }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: t("exportPanel.preflight.adjustFirst") }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(0);
  });

  it("选「仍然导出」后导出一次，同一读数不再问第二次", async () => {
    preflightMocks.runPreflight.mockResolvedValue(OVERFLOW);
    const api = renderModal();

    clickExport();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: t("exportPanel.preflight.exportAnyway") }));

    await waitFor(() =>
      expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(1),
    );

    // 再点一次导出：同一份读数已经确认过，不再打断。
    clickExport();
    await waitFor(() =>
      expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(2),
    );
    expect(
      screen.queryByRole("button", { name: t("exportPanel.preflight.exportAnyway") }),
    ).toBeNull();
  });

  it("没有 blocker 时不打断：交付包直接导出", async () => {
    const api = renderModal();

    clickExport();

    await waitFor(() =>
      expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(1),
    );
    expect(
      screen.queryByRole("button", { name: t("exportPanel.preflight.exportAnyway") }),
    ).toBeNull();
  });

  it("只选 md（没有 pdf/docx）时不发预检，直接导出", async () => {
    const api = renderModal();

    fireEvent.click(screen.getByRole("checkbox", { name: t("delivery.format.pdf") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("delivery.format.md") }));
    clickExport();

    await waitFor(() =>
      expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(1),
    );
    expect(preflightMocks.runPreflight).not.toHaveBeenCalled();
  });

  it("预检失败时放行：导出照常，不因为检查挂了就导不出来", async () => {
    preflightMocks.runPreflight.mockRejectedValue(new Error("boom"));
    const api = renderModal();

    clickExport();

    await waitFor(() =>
      expect(api.calls.filter((call) => call === "export-bundle")).toHaveLength(1),
    );
    expect(
      screen.queryByRole("button", { name: t("exportPanel.preflight.exportAnyway") }),
    ).toBeNull();
  });
});
