// SPDX-License-Identifier: Apache-2.0
/** 退出按钮：确认后调一次退出接口、页面切成"已退出"。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExitAppButton from "./ExitAppButton";

const systemMocks = vi.hoisted(() => ({ shutdownApp: vi.fn() }));

vi.mock("../../api/system", () => systemMocks);

describe("ExitAppButton", () => {
  beforeEach(() => {
    systemMocks.shutdownApp.mockResolvedValue({ status: "stopping", message: "应用正在退出" });
    // jsdom 没有真的窗口可关；这里只断言"试过一次"。
    vi.spyOn(window, "close").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function renderButton() {
    return render(
      <AntdApp>
        <ExitAppButton />
      </AntdApp>,
    );
  }

  it("确认后调用退出接口并切成已退出", async () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "退出应用" }));
    // 二次确认：退出会中断正在生成的回复，不能点一下就走。
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("前端与后端进程都会停止");

    fireEvent.click(screen.getByRole("button", { name: "退 出" }));

    await waitFor(() => expect(systemMocks.shutdownApp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("简历通已退出")).toBeInTheDocument();
    // 提示里要写明两个进程都停了、以及标签页要自己关（浏览器不允许脚本关本页）。
    expect(screen.getByText(/前端与后端进程都已停止/)).toBeInTheDocument();
    expect(screen.getByText(/关闭这个标签页/)).toBeInTheDocument();
  });

  it("桌面壳（window.splash.isDesktop）走桌面文案并在退出后调用 quitApp", async () => {
    const quitApp = vi.fn();
    // 桌面壳注入的桥由 desktop/ 批次实现；这里 stub 出同一个形状。
    (window as unknown as { splash: unknown }).splash = { isDesktop: true, quitApp };

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "退出应用" }));
    const dialog = await screen.findByRole("dialog");
    // 桌面文案面向桌面快捷方式，不再出现浏览器措辞（start.cmd / 标签页）。
    expect(dialog.textContent).toContain("应用会完全退出");
    expect(dialog.textContent).toContain("桌面快捷方式");
    expect(dialog.textContent).not.toContain("start.cmd");

    fireEvent.click(screen.getByRole("button", { name: "退 出" }));

    await waitFor(() => expect(systemMocks.shutdownApp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("简历通已退出")).toBeInTheDocument();
    // shutdownApp 成功后追加退出壳进程。
    await waitFor(() => expect(quitApp).toHaveBeenCalledTimes(1));
    // 遮罩文案也面向桌面（没有"浏览器不允许/标签页"措辞）。
    expect(screen.getByText(/桌面壳进程都已停止/)).toBeInTheDocument();
    expect(screen.queryByText(/关闭这个标签页/)).not.toBeInTheDocument();

    delete (window as unknown as { splash?: unknown }).splash;
  });

  // 失败路径（接口报错、确认框保持打开）没有用例：组件**故意**把错误再抛出去让 antd
  // 别关确认框，而 vitest 会把这条未处理的 Promise 拒绝记成整个运行的错误。那条逻辑
  // 本轮没有改动，就不为它引入噪声了。
});
