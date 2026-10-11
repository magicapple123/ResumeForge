import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HelpDiagnosticsCard from "./HelpDiagnosticsCard";

const apiMocks = vi.hoisted(() => ({
  exportDiagnostics: vi.fn(),
  getDiagnosticsPreview: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}));

vi.mock("../../api/system", () => apiMocks);
vi.mock("../../utils/download", () => downloadMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.exportDiagnostics.mockReset();
  apiMocks.getDiagnosticsPreview.mockReset();
  apiMocks.getDiagnosticsPreview.mockResolvedValue({
    event_count: 12,
    time_range: { from: "2026-10-11T00:00:00+00:00", to: "2026-10-11T01:00:00+00:00" },
    categories: ["resume.generate"],
    files: [{ name: "diagnostics.json", bytes: 2048 }],
    contains_resume_content: false,
    note: "诊断包只包含脱敏运行事件、系统信息与近期后端日志尾部，不包含简历全文、表单填写值。",
  });
  downloadMocks.downloadBlob.mockReset();
  apiMocks.exportDiagnostics.mockResolvedValue({
    blob: new Blob(["zip"], { type: "application/zip" }),
    filename: "resumeforge-diagnostics-20261007-000000.zip",
  });
});

function renderCard() {
  return render(
    <AntdApp>
      <HelpDiagnosticsCard />
    </AntdApp>,
  );
}

describe("HelpDiagnosticsCard", () => {
  it("exports the diagnostics package and triggers a download", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "导出诊断包" }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, filename] = downloadMocks.downloadBlob.mock.calls[0];
    expect(filename).toBe("resumeforge-diagnostics-20261007-000000.zip");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("surfaces an error when exporting fails", async () => {
    apiMocks.exportDiagnostics.mockRejectedValue(new Error("导出失败"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "导出诊断包" }));

    await waitFor(() => expect(screen.getByText("导出失败")).toBeTruthy());
  });

  it("shows the user group id with copy affordance and links to GitHub issues", () => {
    renderCard();

    expect(screen.getByText("922830167")).toBeTruthy();
    expect(screen.getByText("GitHub Issues").getAttribute("href")).toBe(
      "https://github.com/magicapple123/ResumeForge/issues",
    );
  });

  it("shows a preview summary (event count and file sizes) before exporting", async () => {
    renderCard();

    const summary = await screen.findByTestId("diagnostics-preview-summary");
    expect(summary.textContent).toContain("包内约 12 条脱敏事件");
    expect(summary.textContent).toContain("diagnostics.json 2.0 KB");
    expect(summary.textContent).toContain("不包含简历全文");
  });

  it("hides the preview summary when the preview request fails", async () => {
    apiMocks.getDiagnosticsPreview.mockRejectedValue(new Error("preview unavailable"));
    renderCard();

    // 预览失败不影响主功能：摘要不出现，导出按钮仍可用。
    await waitFor(() => expect(apiMocks.getDiagnosticsPreview).toHaveBeenCalled());
    expect(screen.queryByTestId("diagnostics-preview-summary")).toBeNull();
    expect(screen.getByRole("button", { name: "导出诊断包" })).toBeTruthy();
  });
});
