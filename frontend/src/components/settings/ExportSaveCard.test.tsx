import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportSaveCard from "./ExportSaveCard";

const apiMocks = vi.hoisted(() => ({
  getExportSaveLocation: vi.fn(),
  putExportSaveLocation: vi.fn(),
  pickExportSaveFolder: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getExportSaveLocation.mockResolvedValue({ path: "" });
  apiMocks.putExportSaveLocation.mockImplementation(async (path: string) => ({ path }));
  apiMocks.pickExportSaveFolder.mockResolvedValue({ path: null });
});

function renderCard() {
  return render(
    <AntdApp>
      <ExportSaveCard />
    </AntdApp>,
  );
}

describe("ExportSaveCard", () => {
  it("renders the default state without any manual input", async () => {
    renderCard();

    // 只支持点选：页面上不应出现可输入路径的文本框
    expect(screen.queryByRole("textbox", { name: "导出保存目录" })).not.toBeInTheDocument();
    expect(await screen.findByText(/当前：默认（浏览器下载目录）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeDisabled();
  });

  it("shows the persisted path from the backend", async () => {
    apiMocks.getExportSaveLocation.mockResolvedValue({ path: "D:\\ResumeExports" });
    renderCard();

    expect(await screen.findByText(/当前：D:\\ResumeExports/)).toBeInTheDocument();
  });

  it("picks a folder via the native dialog and saves it automatically", async () => {
    apiMocks.pickExportSaveFolder.mockResolvedValue({ path: "D:\\Picked" });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /选择文件夹/ }));

    await waitFor(() => expect(apiMocks.putExportSaveLocation).toHaveBeenCalledWith("D:\\Picked"));
    expect(await screen.findByText("已保存：导出内容将同时存到 D:\\Picked")).toBeInTheDocument();
    expect(await screen.findByText(/当前：D:\\Picked/)).toBeInTheDocument();
  });

  it("keeps silent when the folder dialog is cancelled", async () => {
    apiMocks.pickExportSaveFolder.mockResolvedValue({ path: null });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /选择文件夹/ }));

    await waitFor(() => expect(apiMocks.pickExportSaveFolder).toHaveBeenCalled());
    expect(apiMocks.putExportSaveLocation).not.toHaveBeenCalled();
  });

  it("shows the backend reason when saving the picked folder fails", async () => {
    apiMocks.pickExportSaveFolder.mockResolvedValue({ path: "E:\\readonly" });
    apiMocks.putExportSaveLocation.mockRejectedValue(new Error("目录不可写"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /选择文件夹/ }));

    expect(await screen.findByText("目录不可写")).toBeInTheDocument();
  });

  it("hints a retry when the picker is unavailable", async () => {
    apiMocks.pickExportSaveFolder.mockRejectedValue(new Error("无法打开文件夹选择器，请重试"));
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /选择文件夹/ }));

    expect(await screen.findByText("无法打开文件夹选择器，请重试")).toBeInTheDocument();
    expect(apiMocks.putExportSaveLocation).not.toHaveBeenCalled();
  });

  it("restores the default after a folder was configured", async () => {
    apiMocks.getExportSaveLocation.mockResolvedValue({ path: "D:\\ResumeExports" });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /恢复默认/ }));

    await waitFor(() => expect(apiMocks.putExportSaveLocation).toHaveBeenCalledWith(""));
  });
});
