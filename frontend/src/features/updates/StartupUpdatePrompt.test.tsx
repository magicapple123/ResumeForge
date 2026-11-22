// SPDX-License-Identifier: Apache-2.0
/**
 * 启动更新弹窗：折叠按块切片（7.6）、短说明不出「展开全部」、
 * 「重启并安装」不是 danger（7.5）、桌面形态主按钮接壳（8.1）。
 *
 * 队列与焦点行为不在这里断言：队列在 `utils/userGuide.test.ts` 用纯函数钉住；
 * 焦点依赖真实浏览器焦点管理与 antd 动画，只能真机确认。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { UpdateCheckResult, UpdateStatus } from "../../types";
import StartupUpdatePrompt, { PROMPT_DELAY_MS } from "./StartupUpdatePrompt";

const apiMocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getAppForm: vi.fn(),
  startUpdateDownload: vi.fn(),
  installDownloadedUpdate: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

const downloadStatus = vi.hoisted(() => ({ current: null as UpdateStatus | null }));

vi.mock("../../hooks/useUpdateDownloadStatus", () => ({
  useUpdateDownloadStatus: () => ({ status: downloadStatus.current, setStatus: vi.fn() }),
}));

vi.mock("../../utils/userGuide", () => ({
  acquireStartupSlot: () => Promise.resolve(),
  releaseStartupSlot: vi.fn(),
}));

const RESULT: UpdateCheckResult = {
  current_version: "2.1.0",
  latest_version: "2.2.0",
  update_available: true,
  release_name: "2.2.0",
  release_url: "https://example.test/releases",
  published_at: "2026-11-20T00:00:00Z",
  notes: "",
  message: "",
  checked_at: null,
  download_url: "https://example.test/setup.exe",
  download_size: 135_400_000,
  asset_name: "setup.exe",
  checksum_url: "",
  installable: true,
};

function notesOf(blocks: number): string {
  return Array.from({ length: blocks }, (_, index) => `block ${index + 1}`).join("\n\n");
}

async function openPrompt(result: UpdateCheckResult): Promise<HTMLElement> {
  apiMocks.checkForUpdate.mockResolvedValue(result);
  render(<StartupUpdatePrompt />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS + 50);
  });
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  downloadStatus.current = null;
  apiMocks.checkForUpdate.mockReset();
  apiMocks.getAppForm.mockReset().mockResolvedValue({ desktop: false });
  apiMocks.startUpdateDownload.mockReset();
  apiMocks.installDownloadedUpdate.mockReset();
  delete (window as Window & { rfDesktop?: unknown }).rfDesktop;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("initial focus", () => {
  it("lands on the primary button, not on the close button", async () => {
    await openPrompt({ ...RESULT, notes: notesOf(1) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const primary = screen.getByRole("button", { name: t("update.startup.updateNow") });
    expect(document.activeElement).toBe(primary);
  });
});

describe("release notes folding", () => {
  it("renders only the first three blocks while collapsed", async () => {
    await openPrompt({ ...RESULT, notes: notesOf(5) });

    expect(screen.getByText("block 3")).toBeInTheDocument();
    expect(screen.queryByText("block 4")).not.toBeInTheDocument();
    expect(screen.queryByText("block 5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("update.startup.expand") }));
    expect(screen.getByText("block 5")).toBeInTheDocument();
    expect(screen.queryByText(t("update.startup.expand"))).not.toBeInTheDocument();
  });

  it("hides the expand button when the notes fit in three blocks", async () => {
    await openPrompt({ ...RESULT, notes: notesOf(2) });

    expect(screen.getByText("block 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("update.startup.expand") })).toBeNull();
  });
});

describe("install button", () => {
  it("uses the primary color without danger when the update is ready", async () => {
    downloadStatus.current = {
      state: "ready",
      current_version: "2.1.0",
      target_version: "2.2.0",
      progress: 1,
      downloaded_bytes: 1,
      total_bytes: 1,
      background: true,
      installable: true,
      message: "",
    };

    await openPrompt({ ...RESULT, notes: notesOf(1) });

    const install = screen.getByRole("button", { name: t("update.startup.install") });
    expect(install.className).toContain("ant-btn-primary");
    expect(install.className).not.toContain("ant-btn-dangerous");
    // 已下载态的主按钮同样接管焦点（否则键盘回车会落到右上角 ×）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(document.activeElement).toBe(install);
  });
});

describe("degraded check", () => {
  it("stays quiet when the check could not confirm a version", async () => {
    // 后端 403 降级（`degraded=true`、没有版本号）：启动弹窗必须一句话都不说。
    // 它一旦弹出来，就会和设置页的降级文案、以及桌面壳自己的检查变成三处说法；
    // 而这时它手里连版本号都没有，标题只会写成「发现新版本 」，比不弹更糟。
    apiMocks.checkForUpdate.mockResolvedValue({
      ...RESULT,
      latest_version: "",
      update_available: false,
      degraded: true,
    });

    render(<StartupUpdatePrompt />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS + 50);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    // 仍然问过一次（不能因为"可能降级"就干脆不检查）。
    expect(apiMocks.checkForUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("desktop shell", () => {
  it("replaces the primary action with the in-app updater bridge", async () => {
    const checkUpdate = vi.fn().mockResolvedValue(undefined);
    (window as Window & { rfDesktop?: unknown }).rfDesktop = { checkUpdate };
    apiMocks.getAppForm.mockResolvedValue({ desktop: true });

    await openPrompt({ ...RESULT, notes: notesOf(1) });
    await act(async () => {
      await Promise.resolve();
    });

    const updater = screen.getByRole("button", { name: t("update.startup.openUpdater") });
    fireEvent.click(updater);

    expect(checkUpdate).toHaveBeenCalledTimes(1);
    expect(apiMocks.startUpdateDownload).not.toHaveBeenCalled();
    expect(apiMocks.installDownloadedUpdate).not.toHaveBeenCalled();
  });
});
