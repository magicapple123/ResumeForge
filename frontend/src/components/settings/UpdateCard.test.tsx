/** 软件更新卡片：检查、下载进度与后台下载选项。 */

import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("a delayed initial status cannot replace a newer completed download", async () => {
    let resolveInitial!: (status: { state: string }) => void;
    apiMocks.getUpdateDownloadStatus.mockReturnValueOnce(
      new Promise<{ state: string }>((resolve) => {
        resolveInitial = resolve;
      }),
    );
    renderCard();
    await waitFor(() => expect(apiMocks.getUpdateDownloadStatus).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载更新" }));
    expect(await screen.findByText("更新包已下载完成")).toBeInTheDocument();
    await act(async () => resolveInitial({ state: "idle" }));
    expect(screen.getByText("更新包已下载完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重启并安装" })).toBeInTheDocument();
  });

  it("a status-read error exposes retry and blocks unconfirmed update actions", async () => {
    apiMocks.getUpdateDownloadStatus.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_ERROR"));
    renderCard();
    const retry = await screen.findByRole("button", { name: "重试读取状态" });
    expect(screen.queryByText("SYNTHETIC_PRIVATE_ERROR")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByRole("button", { name: "下载更新" })).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "下载更新" })).toBeEnabled());
  });

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

  it("安装失败后刷新真实状态，红绿不再同屏", async () => {
    // 挂载时后端说 ready：界面显示绿色「已下载完成」+「重启并安装」按钮。
    apiMocks.getUpdateDownloadStatus.mockResolvedValueOnce({
      state: "ready",
      current_version: "0.11.0",
      target_version: "0.12.0",
      progress: 100,
      downloaded_bytes: 2048,
      total_bytes: 2048,
      background: false,
      installable: true,
      message: "更新包已下载完成，可以重启安装",
    });
    // 之后任何一次刷新都返回 idle（模拟后端重启后内存状态丢失）。
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
    apiMocks.installDownloadedUpdate.mockRejectedValueOnce(new Error("更新包还没有下载完成"));

    renderCard();

    expect(await screen.findByText("更新包已下载完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重启并安装" }));

    // 确认弹窗里的「重启并安装」按钮（卡片上那个现在与之重名，取弹窗里的最后一个）。
    const okButtons = await screen.findAllByRole("button", { name: "重启并安装" });
    fireEvent.click(okButtons[okButtons.length - 1]);

    // 红色错误如实出现，并且后端被重新问了一次真实状态（挂载一次 + 纠偏一次）。
    expect(await screen.findByText("更新包还没有下载完成")).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getUpdateDownloadStatus).toHaveBeenCalledTimes(2));

    // 刷新后是 idle：绿色成功框与安装按钮都消失——红绿同屏不可能再现。
    await waitFor(() => expect(screen.queryByText("更新包已下载完成")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "重启并安装" })).not.toBeInTheDocument();
  });

  it("纠偏刷新自身失败时不崩溃，错误照常显示", async () => {
    // 挂载时 ready；安装失败后的那次纠偏刷新**也失败**（状态接口不可用）。
    apiMocks.getUpdateDownloadStatus.mockResolvedValueOnce({
      state: "ready",
      current_version: "0.11.0",
      target_version: "0.12.0",
      progress: 100,
      downloaded_bytes: 2048,
      total_bytes: 2048,
      background: false,
      installable: true,
      message: "更新包已下载完成，可以重启安装",
    });
    apiMocks.getUpdateDownloadStatus.mockRejectedValueOnce(new Error("状态接口挂了"));
    apiMocks.installDownloadedUpdate.mockRejectedValueOnce(new Error("启动安装失败"));

    renderCard();

    expect(await screen.findByText("更新包已下载完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重启并安装" }));
    const okButtons = await screen.findAllByRole("button", { name: "重启并安装" });
    fireEvent.click(okButtons[okButtons.length - 1]);

    // 刷新抛错被 refreshStatus 吞掉：页面没崩，红色错误照常显示。
    expect(await screen.findByText("启动安装失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
  });

  it("更新器没起来时显示「更新器未启动」的失败原因，而不是笼统报错", async () => {
    // 后端等不到更新器握手时的如实自述（state=failed + 原因 message）。
    apiMocks.getUpdateDownloadStatus.mockResolvedValue({
      state: "failed",
      current_version: "0.11.0",
      target_version: "0.12.0",
      progress: 100,
      downloaded_bytes: 2048,
      total_bytes: 2048,
      background: false,
      installable: true,
      message:
        "更新器没有启动，应用没有退出；可以重试，或手动运行 update.cmd。日志：runtime/update.log",
    });

    renderCard();

    // 错误分类（RF-26 §12.5 #10）：原因文案原样展示，可据此与"下载失败/包损坏"区分。
    expect(await screen.findByText(/更新器没有启动/)).toBeInTheDocument();
    expect(screen.getByText(/runtime\/update\.log/)).toBeInTheDocument();
  });

  it("安装中断（更新器半路死了）弹「上次更新没有完成」而不是「失败」或「成功」", async () => {
    apiMocks.getUpdateInstallResult.mockResolvedValue({
      state: "interrupted",
      from_version: "0.11.0",
      target_version: "0.12.0",
      message: "",
      log: "runtime/update.log",
      restart: true,
    });

    renderCard();

    // 标题在 antd 的确认框里会出现两次（modal-title 与 confirm-title），用 findAll。
    expect((await screen.findAllByText(/上次更新没有完成/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(apiMocks.acknowledgeUpdateInstallResult).toHaveBeenCalledOnce());
  });
});
