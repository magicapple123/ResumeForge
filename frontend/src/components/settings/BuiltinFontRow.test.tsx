// SPDX-License-Identifier: Apache-2.0
/**
 * 内置思源黑体那一行：下载 → 轮询 → 自动设为当前；失败 → 重试；卸载 → 停轮询。
 *
 * 三条容易写错、又都安静失败的事，在这里各钉一条：
 *
 * 1. **只在下完这一单之后自动设为当前一次**。每次挂载都设一遍会把用户后来手动换掉的字体
 *    悄悄改回来，而"下完了却没生效"又会被当成 bug；
 * 2. **轮询必须能被清掉**。定时器漏清 = 关掉设置页还在一直打接口；
 * 3. **失败要能重试**。409（正在下载）/ 507（磁盘满）这类错误来自后端，界面要把那句原因
 *    原样给出来，并且给一条"再试一次"的路，而不是留一个点了没反应的按钮。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinFontStatus } from "../../api/settings";
import { t } from "../../i18n";
import BuiltinFontRow, { BUILTIN_FONT_FILE } from "./BuiltinFontRow";

const apiMocks = vi.hoisted(() => ({
  BUILTIN_FONT_FILE: "SourceHanSansSC-Regular.otf",
  resumeFontPreviewUrl: vi.fn(
    (name: string) => `/api/settings/fonts/${encodeURIComponent(name)}/file`,
  ),
  getBuiltinFont: vi.fn(),
  startBuiltinFontDownload: vi.fn(),
  cancelBuiltinFontDownload: vi.fn(),
  deleteBuiltinFont: vi.fn(),
  activateResumeFont: vi.fn(),
  /** 收尾时要读一次清单，判断"当前字体"是不是用户自己选的（决定要不要接管）。 */
  listResumeFonts: vi.fn(),
}));

vi.mock("../../api/fonts", () => apiMocks);

/** 轮询间隔：与组件里的常量同值（500ms），改一处要改两处。 */
const POLL_MS = 500;

const BASE: BuiltinFontStatus = {
  id: "source-han-sans-sc",
  label: "思源黑体",
  size_total: 33493260,
  downloaded: false,
  downloaded_bytes: 0,
  total_bytes: 33493260,
  state: "idle",
  error: "",
};

const IDLE: BuiltinFontStatus = BASE;
const DOWNLOADING: BuiltinFontStatus = {
  ...BASE,
  state: "downloading",
  downloaded_bytes: 8 * 1024 * 1024,
};
const DONE: BuiltinFontStatus = {
  ...BASE,
  state: "done",
  downloaded: true,
  downloaded_bytes: BASE.total_bytes,
};
const FAILED: BuiltinFontStatus = { ...BASE, state: "failed", error: "网络中断" };

/** 预估体积那一行的文案来源（32MB 取整后就是「约 32 MB」）。 */
const APPROX = "32 MB";

/**
 * 「删除」按钮的可访问名：antd 会在两个汉字之间插入一个空格（渲染成「删 除」），
 * 所以按整串取会命中不到。从 i18n key 现造正则，避免在测试里另写一份中文。
 */
const DELETE_BUTTON = new RegExp(t("fontDownload.delete").split("").join("\\s*"));

/** 删除已收进「更多操作」：先点开菜单，再点菜单项。 */
async function clickDeleteMenuItem() {
  fireEvent.click(screen.getByRole("button", { name: t("common.action.more") }));
  await flush();
  fireEvent.click(screen.getByRole("menuitem", { name: DELETE_BUTTON }));
  await flush();
}

function renderRow(
  status: BuiltinFontStatus | null,
  onChanged: () => void = () => undefined,
  activeName: string | null = null,
) {
  return render(
    <AntdApp>
      <BuiltinFontRow status={status} onChanged={onChanged} activeName={activeName} />
    </AntdApp>,
  );
}

/** 把已 resolve 的 promise 推完（不依赖 RTL 的 `waitFor`：本文件用假定时器）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function advance(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  apiMocks.getBuiltinFont.mockReset().mockResolvedValue(DONE);
  apiMocks.startBuiltinFontDownload.mockReset().mockResolvedValue(DOWNLOADING);
  apiMocks.cancelBuiltinFontDownload.mockReset().mockResolvedValue(IDLE);
  apiMocks.deleteBuiltinFont.mockReset().mockResolvedValue(undefined);
  apiMocks.activateResumeFont.mockReset().mockResolvedValue({ active: BUILTIN_FONT_FILE });
  apiMocks.listResumeFonts
    .mockReset()
    .mockResolvedValue({ items: [], active: null, max_bytes: 30 * 1024 * 1024 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("BuiltinFontRow", () => {
  it("status 为 null（老后端没有这个接口）时整行不渲染", () => {
    const { container } = renderRow(null);
    expect(container.textContent).toBe("");
  });

  it("未下载：显示名字、体积与「下载」按钮（可访问名带体积）", () => {
    renderRow(IDLE);

    expect(screen.getByText(t("fonts.builtin.name"))).toBeInTheDocument();
    expect(screen.getByText(t("fonts.builtin.approx-size", { size: APPROX }))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("fonts.builtin.download-aria", { size: APPROX }) }),
    ).toBeInTheDocument();
  });

  it("点「下载」→ 轮询到 done → 只自动设为当前一次，并通知父组件重拉清单", async () => {
    const onChanged = vi.fn();
    renderRow(IDLE, onChanged);

    fireEvent.click(
      screen.getByRole("button", { name: t("fonts.builtin.download-aria", { size: APPROX }) }),
    );
    await flush();
    expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledTimes(1);

    // 下载中：按钮禁用（loading）并显示进度，避免重复点击。
    // 按钮的可访问名会被 antd 的 loading 图标加上 "loading" 前缀，所以按进度文案取节点。
    const progress = screen.getByRole("button", { name: /下载中/ });
    expect(progress).toBeDisabled();
    expect(progress.textContent).toContain(
      t("fonts.builtin.downloading-with-total", { done: "8.0 MB", total: APPROX }),
    );
    expect(apiMocks.activateResumeFont).not.toHaveBeenCalled();

    // 一拍之后读到 done：自动设为当前（一次），并请父组件刷新字体清单。
    await advance(POLL_MS);
    await flush();
    expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1);
    expect(apiMocks.activateResumeFont).toHaveBeenCalledTimes(1);
    expect(apiMocks.activateResumeFont).toHaveBeenCalledWith(BUILTIN_FONT_FILE);
    expect(onChanged).toHaveBeenCalledTimes(1);

    // 再走两拍：状态已离开 downloading，定时器被清掉，不会重复设当前、也不再打接口。
    await advance(POLL_MS * 2);
    expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1);
    expect(apiMocks.activateResumeFont).toHaveBeenCalledTimes(1);
    await flush();

    // 已下载态：Tag + 「设为当前」（手动再设一次的口子）。
    expect(screen.getByText(t("fonts.builtin.downloaded"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /设为当前/ })).toBeInTheDocument();
  });

  it("卸载后停掉轮询：不会继续打状态接口", async () => {
    const { unmount } = renderRow(DOWNLOADING);

    await advance(POLL_MS);
    expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1);

    unmount();
    await advance(POLL_MS * 3);
    expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1);
  });

  it("POST 直接失败（磁盘满 / 正在下载）时给出原因，并可以「重试」", async () => {
    apiMocks.startBuiltinFontDownload.mockRejectedValueOnce(
      new Error("磁盘空间不足，无法保存字体"),
    );
    renderRow(IDLE);

    fireEvent.click(
      screen.getByRole("button", { name: t("fonts.builtin.download-aria", { size: APPROX }) }),
    );
    await flush();

    // 后端那句话原样出现（它是用户唯一能据以行动的线索）。
    expect(document.body.textContent).toContain(
      t("fonts.builtin.failed", { error: "磁盘空间不足，无法保存字体" }),
    );

    apiMocks.startBuiltinFontDownload.mockResolvedValueOnce(DOWNLOADING);
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await flush();
    expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledTimes(2);
  });

  it("后端报 failed 时显示失败文案；「重试」再发一次下载", async () => {
    renderRow(FAILED);

    expect(document.body.textContent).toContain(t("fonts.builtin.failed", { error: "网络中断" }));

    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await flush();
    expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledTimes(1);
  });

  it("已下载态挂载时**不会**自动改当前字体（用户手动换过的字不该被改回来）", async () => {
    renderRow(DONE);

    await advance(POLL_MS * 2);
    expect(apiMocks.activateResumeFont).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("fonts.builtin.activate") }));
    await flush();
    expect(apiMocks.activateResumeFont).toHaveBeenCalledWith(BUILTIN_FONT_FILE);
  });

  it("下完时如果用户本来就用着自己导入的字体，不去接管「当前字体」", async () => {
    // 后端 `_ensure_active` 对这种情况也是"不动"：用户明确选过的偏好优先于"刚下好"。
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [],
      active: "我的字体.ttf",
      max_bytes: 30 * 1024 * 1024,
    });
    const onChanged = vi.fn();
    renderRow(IDLE, onChanged);

    fireEvent.click(
      screen.getByRole("button", { name: t("fonts.builtin.download-aria", { size: APPROX }) }),
    );
    await flush();
    await advance(POLL_MS);
    await flush();

    expect(apiMocks.activateResumeFont).not.toHaveBeenCalled();
    // 清单仍要刷新：列表里多了一款可选的字体，界面得看见。
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("fonts.builtin.downloaded"))).toBeInTheDocument();
  });

  // ── P0-2：已下载可删除 ──────────────────────────────────────────

  it("未下载时没有「删除」；已下载才出现在「更多操作」里（下载中也不出现）", async () => {
    const idle = renderRow(IDLE);
    expect(screen.queryByRole("button", { name: t("common.action.more") })).toBeNull();
    idle.unmount();

    renderRow(DOWNLOADING);
    expect(screen.queryByRole("button", { name: t("common.action.more") })).toBeNull();
    cleanup();

    renderRow(DONE);
    expect(screen.getByRole("button", { name: t("common.action.more") })).toBeInTheDocument();
    // 删除不裸露：只在菜单项里。
    expect(screen.queryByRole("button", { name: DELETE_BUTTON })).toBeNull();
  });

  it("删除要二次确认：正文写明没有恢复入口，确认后才真的删", async () => {
    const onChanged = vi.fn();
    renderRow(DONE, onChanged);

    await clickDeleteMenuItem();
    // 确认弹窗出现且删除尚未发生。
    await flush();
    expect(screen.getByText(t("fontDownload.deleteConfirmBody"))).toBeInTheDocument();
    expect(apiMocks.deleteBuiltinFont).not.toHaveBeenCalled();

    await flush();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: DELETE_BUTTON }));
    await flush();

    expect(apiMocks.deleteBuiltinFont).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(t("fontDownload.deleted"));
    // 清单要重拉：列表里那一款消失了，界面得如实反映。
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("删掉的正是当前字体：提示写明已回到系统字体", async () => {
    renderRow(DONE, () => undefined, BUILTIN_FONT_FILE);

    await clickDeleteMenuItem();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: DELETE_BUTTON }));
    await flush();

    expect(document.body.textContent).toContain(t("fontDownload.deletedAndResetToSystem"));
  });

  it("删除失败（文件被占用）时给原因，并且不弹成功", async () => {
    apiMocks.deleteBuiltinFont.mockRejectedValueOnce(new Error("字体文件正被占用，无法删除"));
    renderRow(DONE);

    await clickDeleteMenuItem();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: DELETE_BUTTON }));
    await flush();

    expect(document.body.textContent).toContain(
      t("fontDownload.deleteFailed", { error: "字体文件正被占用，无法删除" }),
    );
    expect(document.body.textContent).not.toContain(t("fontDownload.deleted"));
    // 状态保持：Tag 还在，行仍显示"已下载"。
    expect(screen.getByText(t("fonts.builtin.downloaded"))).toBeInTheDocument();
  });

  // ── P1-1：点名字看样张 ──────────────────────────────────────────

  it("已下载时点字体名打开样张（四行都渲染）", async () => {
    renderRow(DONE);

    fireEvent.click(screen.getByRole("button", { name: t("fonts.builtin.name") }));

    await flush();
    expect(screen.getByTestId("font-sample")).toBeInTheDocument();
    expect(screen.getByText(t("fontDownload.sampleLineTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("fontDownload.sampleLineBold"))).toBeInTheDocument();
  });

  it("未下载时点字体名只给一句提示，不打开空弹窗", async () => {
    renderRow(IDLE);

    fireEvent.click(screen.getByRole("button", { name: t("fonts.builtin.name") }));
    await flush();

    expect(screen.queryByTestId("font-sample")).toBeNull();
    expect(document.body.textContent).toContain(t("fontDownload.sampleNotDownloaded"));
  });
});
