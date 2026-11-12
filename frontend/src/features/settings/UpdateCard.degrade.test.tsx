// SPDX-License-Identifier: Apache-2.0
/**
 * 软件更新卡片的**形态与降级**部分：桌面形态不给页面内下载/安装入口、形态探测接口
 * 失败时静默按浏览器形态处理、冷却结束后的「重新检查」，以及桌面壳更新桥的三段式说明。
 *
 * 与 `UpdateCard.test.tsx`（基础渲染 + 下载/安装状态机 + 检查更新的 60 秒节流）本来是
 * 同一个文件，为守住 500 行测试预算按主题拆成两个；夹具与 mock 完整重复一份，用例一条
 * 没删、断言一条没改。
 */

import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import UpdateCard from "./UpdateCard";

const apiMocks = vi.hoisted(() => ({
  acknowledgeUpdateInstallResult: vi.fn(),
  checkForUpdate: vi.fn(),
  getAppForm: vi.fn(),
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
  // 默认按浏览器/控制台形态（既有行为）；桌面形态的用例自己覆盖。
  apiMocks.getAppForm.mockResolvedValue({
    desktop: false,
    platform: "win32",
    app_version: "1.0.2",
  });
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

describe("UpdateCard（形态与降级）", () => {
  it("桌面形态不给页面内下载/安装入口，改成引导用 Setup.exe", async () => {
    // 桌面安装里 PROJECT_ROOT 是 resources/payload，更新包是源码形态整包（没有
    // python-runtime.zip、没有 desktop/）：页面内"下载 zip 并安装"补不齐依赖，
    // 装上去只会半新半旧。所以按钮必须消失，只留检查更新 + 安装包指引。
    apiMocks.getAppForm.mockResolvedValue({
      desktop: true,
      platform: "win32",
      app_version: "1.0.2",
    });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    // 有更新（mock 里 update_available=true），但桌面形态不出现下载/安装按钮。
    expect(await screen.findByText(t("update.desktop.title"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载更新" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重启并安装" })).not.toBeInTheDocument();
    // 后台下载开关也随之消失（它是下载入口的一部分）。
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // 检查/重新检查保留；发布页面可以打开。
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "打开发布页面" })).toHaveAttribute(
      "href",
      "https://example.com/release",
    );
  });

  it("桌面形态即使后端说「已下载完成」也不显示重启并安装", async () => {
    apiMocks.getAppForm.mockResolvedValue({
      desktop: true,
      platform: "win32",
      app_version: "1.0.2",
    });
    apiMocks.getUpdateDownloadStatus.mockResolvedValue({
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

    renderCard();

    // 后端状态是 ready，但桌面形态下那个按钮不该出现（走了也装不成）。
    expect(await screen.findByText(t("update.desktop.title"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重启并安装" })).not.toBeInTheDocument();
    expect(screen.queryByText(t("update.downloaded.title"))).not.toBeInTheDocument();
  });

  it("浏览器形态保持原有入口：可下载、可安装", async () => {
    // 非桌面（控制台 start.cmd / 开发态）是既有路径，界面必须逐条不变。
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByRole("button", { name: "下载更新" })).toBeEnabled();
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.queryByText(t("update.desktop.title"))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载更新" }));
    expect(await screen.findByText(t("update.downloaded.title"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重启并安装" })).toBeInTheDocument();
  });

  it("形态接口失败时静默按浏览器形态处理，设置页不报错", async () => {
    // 老后端没有 /system/form；不能让多问一句就把整张卡片变成错误框。
    apiMocks.getAppForm.mockRejectedValueOnce(new Error("SYNTHETIC_FORM_ERROR"));

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByRole("button", { name: "下载更新" })).toBeEnabled();
    expect(screen.queryByText("SYNTHETIC_FORM_ERROR")).not.toBeInTheDocument();
    expect(screen.queryByText(t("update.desktop.title"))).not.toBeInTheDocument();
  });

  it("冷却结束后「重新检查」传 refresh=true（用户明确要一次新结果）", async () => {
    // 60 秒真实等待太慢：把时钟拨快（只在这条用例里用假定时器）。
    vi.useFakeTimers();
    try {
      renderCard();
      fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
      await act(async () => undefined);
      expect(apiMocks.checkForUpdate).toHaveBeenLastCalledWith(false);

      const recheck = screen.getByRole("button", { name: "重新检查" });
      expect(recheck).toBeDisabled();
      // 冷却倒计时是每秒一次的 setTimeout：一次推进 61 秒不会让整条链跑完（下一跳要等
      // React 把新 effect 装上去，所以要逐秒推进）。
      for (let step = 0; step < 61; step += 1) {
        await act(async () => {
          vi.advanceTimersByTime(1_000);
        });
      }
      expect(screen.getByRole("button", { name: "重新检查" })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
      await act(async () => undefined);
      expect(apiMocks.checkForUpdate).toHaveBeenLastCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("桌面壳有更新桥时，检查更新交给主进程：桥被调一次，页面不再问后端", async () => {
    const checkUpdate = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { rfDesktop?: unknown }).rfDesktop = { checkUpdate };
    apiMocks.getAppForm.mockResolvedValue({
      desktop: true,
      platform: "win32",
      app_version: "2.2.0",
    });

    try {
      renderCard();
      // 蓝框出现即说明形态探测已落地（desktop=true）。
      await screen.findByText(t("update.desktop.title"));

      fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

      await waitFor(() => expect(checkUpdate).toHaveBeenCalledTimes(1));
      // 走桥就不再打后端：那条结果与"应用真的会不会升级"无关，反而会造成两份结论。
      expect(apiMocks.checkForUpdate).not.toHaveBeenCalled();
      expect(await screen.findByText(t("update.toast.desktopStarted"))).toBeInTheDocument();
    } finally {
      delete (window as unknown as { rfDesktop?: unknown }).rfDesktop;
    }
  });

  it("桌面旧壳没有更新桥：回退 A 方案的三段式说明，检查照常可用且不报错", async () => {
    // 2.0 / 2.1 的壳没有这条 IPC 通道。能力探测失败就地回退：说明文字三段都在，
    // 「检查更新」仍然直接问后端（有结论可看），页面不抛错。
    apiMocks.getAppForm.mockResolvedValue({
      desktop: true,
      platform: "win32",
      app_version: "2.2.0",
    });

    renderCard();
    await screen.findByText(t("update.desktop.title"));
    // ① 谁在检查、什么时候检查；② 手动入口（菜单 + update.cmd）
    expect(screen.getByText(t("update.desktop.description"))).toBeInTheDocument();
    expect(screen.getByText(t("update.desktop.manual"))).toBeInTheDocument();
    // ③ 保底出口：发布页链接始终可见（走桌面桥时页面里没有 result 可用）。
    expect(screen.getByRole("link", { name: t("update.action.release") })).toHaveAttribute(
      "href",
      expect.stringContaining("github.com"),
    );

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    await waitFor(() => expect(apiMocks.checkForUpdate).toHaveBeenCalledWith(false));
    // 回退路径照常给结论，且没有错误 Alert（桌面形态的蓝框本身也是 role=alert，
    // 所以这里按样式判定"没有红色错误框"，而不是按 role 数元素）。
    expect(document.querySelector(".ant-alert-error")).toBeNull();
  });
});
