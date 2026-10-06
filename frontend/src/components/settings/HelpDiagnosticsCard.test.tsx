import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HelpDiagnosticsCard from "./HelpDiagnosticsCard";

const apiMocks = vi.hoisted(() => ({
  exportDiagnostics: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}));

vi.mock("../../api/system", () => apiMocks);
vi.mock("../../utils/download", () => downloadMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.exportDiagnostics.mockReset();
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
});
