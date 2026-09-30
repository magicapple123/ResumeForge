/** 软件更新卡片：检查、下载进度与后台下载选项。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpdateCard from "./UpdateCard";

const apiMocks = vi.hoisted(() => ({
  acknowledgeUpdateInstallResult: vi.fn(),
  checkForUpdate: vi.fn(),
  getUpdateDownloadStatus: vi.fn(),
  getUpdateInstallResult: vi.fn(),
  startUpdateDownload: vi.fn(),
  installDownloadedUpdate: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

const latest = {
  current_version: "0.11.0",
  latest_version: "0.12.0",
  update_available: true,
  release_name: "新版本",
  release_url: "https://example.com/release",
  published_at: "2026-09-24T00:00:00Z",
  notes: "修复问题",
  message: "有新版本 0.12.0 可用",
  checked_at: "2026-09-24T00:00:00Z",
  download_url: "https://example.com/update.zip",
  download_size: 2048,
  asset_name: "ResumeForge-0.12.0.zip",
  checksum_url: "https://example.com/update.zip.sha256",
  installable: true,
};

function renderCard() {
  return render(
    <AntdApp>
      <UpdateCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  apiMocks.getUpdateDownloadStatus.mockResolvedValue({
    state: "idle",
    current_version: "0.11.0",
    target_version: "",
    progress: 0,
    downloaded_bytes: 0,
    total_bytes: null,
    background: false,
    installable: false,
    message: "",
  });
  apiMocks.checkForUpdate.mockResolvedValue(latest);
  apiMocks.getUpdateInstallResult.mockResolvedValue(null);
  apiMocks.acknowledgeUpdateInstallResult.mockResolvedValue(undefined);
  apiMocks.startUpdateDownload.mockResolvedValue({
    state: "ready",
    current_version: "0.11.0",
    target_version: "0.12.0",
    progress: 100,
    downloaded_bytes: 2048,
    total_bytes: 2048,
    background: true,
    installable: true,
    message: "更新包已下载完成，可以重启安装",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UpdateCard", () => {
  it("checks for updates, offers background download, and shows the ready state", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getUpdateDownloadStatus).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByRole("button", { name: "下载更新" })).toBeEnabled();

    const backgroundSwitch = screen.getByRole("switch");
    fireEvent.click(backgroundSwitch);
    expect(backgroundSwitch).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "下载更新" }));

    await waitFor(() => expect(apiMocks.startUpdateDownload).toHaveBeenCalledWith(true));
    expect(await screen.findByText("更新包已下载完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重启并安装" })).toBeInTheDocument();
  });

  it("只有后端说成功才弹「已更新」", async () => {
    apiMocks.getUpdateInstallResult.mockResolvedValue({
      state: "success",
      from_version: "0.11.0",
      target_version: "0.12.0",
      message: "已更新到 0.12.0",
      log: "runtime/update.log",
      restart: true,
    });

    renderCard();

    expect(await screen.findByText(/已更新到 0.12.0/)).toBeInTheDocument();
    // 看过就销掉，免得每次打开设置都弹一遍。
    await waitFor(() => expect(apiMocks.acknowledgeUpdateInstallResult).toHaveBeenCalledOnce());
  });

  it("安装失败时如实报错，并指出日志在哪", async () => {
    apiMocks.getUpdateInstallResult.mockResolvedValue({
      state: "failed",
      from_version: "0.11.0",
      target_version: "0.12.0",
      message: "文件已覆盖，但 240 秒内没等到新版本起来",
      log: "runtime/update.log",
      restart: true,
    });

    renderCard();

    // 旧版本会在点击安装时就写一个"已完成"的标记，装崩了下次打开照样说"已更新"。
    // 现在成败由后端按**实际运行的版本号**判定。
    // 标题在 antd 的确认框里会出现两次（modal-title 与 confirm-title），用 findAll。
    expect((await screen.findAllByText(/上次更新失败/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/文件已覆盖，但 240 秒内没等到新版本起来/)).toBeInTheDocument();
    expect(screen.getByText("runtime/update.log")).toBeInTheDocument();
  });
});
