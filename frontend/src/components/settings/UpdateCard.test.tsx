// SPDX-License-Identifier: Apache-2.0
/** 软件更新卡片：检查、下载进度与后台下载选项。 */

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
  // 默认按浏览器/控制台形态（既有行为）；桌面形态的用例在 .degrade 文件里自己覆盖。
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

  it("版本说明按 markdown 渲染：## 变标题、- 变列表、**变粗体**，不再直出原始符号", async () => {
    // 回归（用户实测）：版本说明是 GitHub Release 的 markdown 原文，此前纯文本直出，
    // 用户看到一行行 `## 新增`、`- **xxx**`。这里断言三种语法都被渲染掉。
    apiMocks.checkForUpdate.mockResolvedValue({
      ...latest,
      notes: "## 新增\n- **深挖** 模式支持从台账直出报告\n\n修复问题",
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    // 说明块默认收起（#11）：先展开，再看渲染结果——渲染器本身没变，只是挂载位置变了。
    fireEvent.click(await screen.findByRole("button", { name: t("update.notes.expand") }));

    // `## 新增` → 标题；`- **深挖** …` → 列表项（内含 strong）。
    expect(await screen.findByRole("heading", { name: "新增" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    expect(screen.getByText("深挖").closest("strong")).not.toBeNull();
    expect(screen.getByText("修复问题")).toBeInTheDocument();
    // 原始 markdown 符号不再出现在界面上。
    const card = document.querySelector(".settings-card") as HTMLElement;
    expect(card.textContent ?? "").not.toContain("##");
    expect(card.textContent ?? "").not.toContain("**");
  });

  it("结论条不再承载发布说明：说明独立成块、默认收起、没有内滚（#11）", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: t("update.action.check") }));

    // ① Alert 只剩结论（有新版 + 版本号）与主操作（发布页）。
    const conclusion = await screen.findByText(t("update.result.available", { version: "0.12.0" }));
    expect(conclusion).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("update.action.release") })).toHaveAttribute(
      "href",
      "https://example.com/release",
    );

    // ② 说明块**不在** Alert 里：这正是 789px 卡片的成因（Alert 占掉六成高）。
    const notes = document.querySelector(".update-notes-body") as HTMLElement;
    expect(notes).not.toBeNull();
    expect(notes.closest(".ant-alert")).toBeNull();

    // ③ 无内滚：说明块不设 inline 的 maxHeight/overflow（病因是 `min(40vh, 420px)`）。
    expect(notes).not.toHaveAttribute("style");

    // ④ 默认收起：长公告不把卡片一进来就撑长；开关如实报告状态。
    const toggle = screen.getByRole("button", { name: t("update.notes.expand") });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: t("update.notes.collapse") })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // 展开后说明正文确实在里面（夹具的 notes 是「修复问题」）。
    expect(notes.textContent).toContain("修复问题");
  });

  it("四列等宽版本信息：通道 / 当前 / 最新 / 发布时间（发布时间从 Alert 搬来）", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: t("update.action.check") }));

    await screen.findByText(t("update.result.available", { version: "0.12.0" }));
    // 四列等宽：通道 / 当前 / 最新 / 发布时间。发布时间从 Alert 里搬到了这里。
    expect(document.querySelectorAll(".update-meta-item")).toHaveLength(4);
    expect(screen.getByText("2026-09-24")).toBeInTheDocument();
  });

  it("点检查更新发现新版本：立刻给出含版本号的反馈（QA ST.04）", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(
      await screen.findByText(
        t("update.check.available", { version: "0.12.0" }),
        {},
        {
          timeout: 5000,
        },
      ),
    ).toBeInTheDocument();
  });

  it("点检查更新且已是最新：给出「已是最新版本」反馈，不出现下载入口", async () => {
    apiMocks.checkForUpdate.mockResolvedValue({
      ...latest,
      current_version: "1.0.2",
      latest_version: "1.0.2",
      update_available: false,
      message: "",
    });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(
      await screen.findByText(
        t("update.check.latest", { version: "1.0.2" }),
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    // 结论条同步给出「已是最新版本」（#11：Alert 只留结论，不再塞发布说明）。
    expect(await screen.findByText(t("update.result.uptodate"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载更新" })).not.toBeInTheDocument();
  });

  it("检查更新失败：错误 Alert 仍明确显示原因（保留既有反馈）", async () => {
    apiMocks.checkForUpdate.mockRejectedValue(new Error("网络不可用，请稍后重试"));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    // 用 role=alert + textContent 断言：ByText 的中文实参会推高 cjkRatchet 的 tests 基线。
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("网络不可用，请稍后重试");
  });

  // ── P2-1：refresh 口径与 60 秒最小点击间隔 ────────────────────────────────

  it("「检查更新」走缓存（refresh=false），60 秒内连点只打一次后端", async () => {
    // 后端的 15 分钟缓存靠 refresh=false：第一次点「检查更新」不该强制刷新上游
    // （GitHub 匿名额度是 60 次/小时，用户点几下就用完——这正是 01-2 的现场）。
    renderCard();
    const checkButton = screen.getByRole("button", { name: "检查更新" });

    fireEvent.click(checkButton);
    await waitFor(() => expect(apiMocks.checkForUpdate).toHaveBeenCalledTimes(1));
    expect(apiMocks.checkForUpdate).toHaveBeenLastCalledWith(false);

    // 冷却期内按钮禁用，连点不再产生请求（后端还有一道 60s 闸，见后端用例）。
    await waitFor(() => expect(checkButton).toBeDisabled());
    fireEvent.click(checkButton);
    fireEvent.click(checkButton);
    expect(apiMocks.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  // ── P2-2：「重新检查」与桌面壳更新桥的用例在 UpdateCard.degrade.test.tsx ──
});
