// SPDX-License-Identifier: Apache-2.0
/**
 * 投递专用浏览器工具条的交互测试。
 *
 * 重点盯住"启动浏览器"这件事的可用性：只开一个空白窗口是没有意义的，
 * 用户需要的是那个能扫码登录的招聘网站页面，所以这里验证
 * 「打开招聘网站」按钮的可用性条件与点击行为。
 *
 * 另一组盯住"关闭浏览器"：后端重启后浏览器仍在跑、句柄却丢了，这种窗口**关不掉**。
 * 按钮必须置灰**并且把原因写在页面上**——禁用按钮不派发鼠标事件，挂在悬停提示里的
 * 解释等于没写。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserStatus } from "../../types";
import { t } from "../../i18n";
import BrowserStatusBar from "./BrowserStatusBar";

const apiMocks = vi.hoisted(() => ({
  getBrowserStatus: vi.fn(),
  startBrowser: vi.fn(),
  stopBrowser: vi.fn(),
  openBrowserSite: vi.fn(),
}));

vi.mock("../../api/apply", () => ({ ...apiMocks }));

const apiState = vi.hoisted(() => ({
  data: null as BrowserStatus | null,
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
  setData: vi.fn(),
}));

// useBrowserStatus 已自持 data/loading/error 状态并做了轮询响应浅比较（不再经过 useApi），
// 这里改为在 hook 边界上注入同一形状的状态块，断言全部保持不变。
vi.mock("../../hooks/useBrowserStatus", () => ({
  useBrowserStatus: () => apiState,
  BROWSER_STATUS_POLL_INTERVAL_MS: 1500,
}));

/** 站点入口：断言时当数据引用，不把 URL 重复写进多处。 */
const ENTRY_URL = "https://www.zhipin.com/";

const RUNNING_WITH_ENTRY: BrowserStatus = {
  state: "running",
  port: 9333,
  profile_dir: "C:/data/browser-profile",
  browser_path: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  browser_name: "Google Chrome",
  entry_url: ENTRY_URL,
  logged_in_hint: "首次使用请在弹出的浏览器窗口里扫码登录一次。",
  owned: true,
};

const STOPPED: BrowserStatus = {
  ...RUNNING_WITH_ENTRY,
  state: "stopped",
  browser_path: "",
  browser_name: "",
  owned: false,
};

/** 上一次运行留下的窗口：端口在答（照常能用），但本进程没有它的句柄，关不掉。 */
const RUNNING_FROM_A_PREVIOUS_RUN: BrowserStatus = {
  ...RUNNING_WITH_ENTRY,
  owned: false,
};

function renderBar() {
  return render(
    <AntdApp>
      <BrowserStatusBar />
    </AntdApp>,
  );
}

/**
 * 打开「⋯」菜单（#14G 第二版：关闭/刷新/说明三个按钮收进来了，首屏只留一个主按钮）。
 * 返回后即可用 `getByRole("menuitem", ...)` 断言里面的三项。
 */
async function openMoreMenu(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: t("browserStatus.more.aria") }));
  await screen.findByRole("menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  apiState.data = null;
  apiState.loading = false;
  apiState.error = null;
  localStorage.removeItem("resumeforge.apply.browser_hint_seen");
  localStorage.removeItem("resumeforge.apply.browser_hint_seen");
});

// 项目未开启 vitest globals，自动清理不会生效，必须显式注册，
// 否则上一个用例渲染的组件会残留导致查询命中多个元素。
afterEach(cleanup);

describe("BrowserStatusBar", () => {
  it("浏览器未启动时只给「启动浏览器」，不摆一个点了没反应的「打开招聘网站」", () => {
    // #14G 第二版：主按钮随状态换语义（未启动=启动浏览器，运行中=打开招聘网站），
    // 两个同时常驻既占宽度又让用户自己判断先点哪个。
    apiState.data = STOPPED;
    renderBar();

    expect(
      screen.getByRole("button", { name: new RegExp(t("browserStatus.action.start")) }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: new RegExp(t("browserStatus.action.openSite")) }),
    ).not.toBeInTheDocument();
  });

  it("浏览器运行中时「打开招聘网站」可用，点击会请求后端导航", async () => {
    apiState.data = RUNNING_WITH_ENTRY;
    apiMocks.openBrowserSite.mockResolvedValue(RUNNING_WITH_ENTRY);
    renderBar();

    const openButton = screen.getByRole("button", {
      name: new RegExp(t("browserStatus.action.openSite")),
    });
    expect(openButton).toBeEnabled();

    fireEvent.click(openButton);

    await waitFor(() => expect(apiMocks.openBrowserSite).toHaveBeenCalledTimes(1));
  });

  it("站点没有配置入口地址时不提供这个按钮能力", () => {
    apiState.data = { ...RUNNING_WITH_ENTRY, entry_url: "" };
    renderBar();

    expect(
      screen.getByRole("button", { name: new RegExp(t("browserStatus.action.openSite")) }),
    ).toBeDisabled();
  });

  it("展示站点入口地址，让用户知道这个窗口会去哪里", async () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    // #14G 第二版：三段说明在「⋯ → 使用说明」打开的弹窗里（弹层不进流，不占首屏高度）。
    await openMoreMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: new RegExp(t("browserStatus.help.trigger")) }),
    );

    expect(
      await screen.findByText(t("browserStatus.entry", { url: ENTRY_URL })),
    ).toBeInTheDocument();
  });

  it("展示实际使用的浏览器名，而不只是一串路径", async () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    await openMoreMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: new RegExp(t("browserStatus.help.trigger")) }),
    );

    expect(await screen.findByText(t("browserStatus.browser"), { exact: false })).toHaveTextContent(
      "Google Chrome",
    );
  });

  it("三段说明默认不在页面上（首屏让给队列表格），只留在使用说明里", () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    // 这一段有 164px 高，常驻会把首屏表格挤到只剩 3 行（#14G）。
    expect(document.body.textContent).not.toContain(t("browserStatus.intro"));
    expect(document.body.textContent).not.toContain(t("browserStatus.entry", { url: ENTRY_URL }));
    expect(document.body.textContent).not.toContain(t("browserStatus.browser"));
    // 入口本身必须在：删掉说明不等于让首次使用的人找不到说明。
    expect(screen.getByRole("button", { name: t("browserStatus.more.aria") })).toBeInTheDocument();
  });

  it("未登录时扫码提示仍然常驻页面，没有被收进说明里", () => {
    // 扫码提示是"需要你做一个动作"的提醒，显隐由后端 logged_in_hint 决定。
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    expect(screen.getByText("首次使用请在弹出的浏览器窗口里扫码登录一次。")).toBeInTheDocument();
  });

  it("本次运行启动的窗口可以关闭", async () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    await openMoreMenu();
    expect(
      screen.getByRole("menuitem", { name: new RegExp(t("browserStatus.action.stop")) }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("未启动时没有可关的窗口", async () => {
    apiState.data = STOPPED;
    renderBar();

    await openMoreMenu();
    expect(
      screen.getByRole("menuitem", { name: new RegExp(t("browserStatus.action.stop")) }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("上一次运行留下的窗口照常可用，但关不掉——原因直接写在页面上", async () => {
    // 后端重启会丢掉进程句柄，而应用只关自己拉起的窗口（绝不按 PID 去猜）。
    // 这种窗口照样能采集、能投递，所以状态仍是"运行中"，只有关闭能力被收回。
    apiState.data = RUNNING_FROM_A_PREVIOUS_RUN;
    renderBar();

    // 光置灰不够：用户会以为按钮坏了。原因必须可见，不能藏在悬停提示里
    // （禁用按钮不派发鼠标事件，Tooltip 根本弹不出来）——所以它在页面上，
    // 只有「关闭浏览器」这一项被 disable。
    expect(screen.getByText(/上一次运行/)).toBeInTheDocument();
    expect(screen.getByText(/采集与投递不受影响/)).toBeInTheDocument();
    await openMoreMenu();
    expect(
      screen.getByRole("menuitem", { name: new RegExp(t("browserStatus.action.stop")) }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("浏览器是本次启动时不显示那段说明，避免噪音", () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    expect(screen.queryByText(/关不掉它/)).not.toBeInTheDocument();
  });

  it("提供手动刷新入口，并把刷新动作交给状态 hook", async () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();

    await openMoreMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: new RegExp(t("browserStatus.aria.reload")) }),
    );

    expect(apiState.reload).toHaveBeenCalledTimes(1);
  });

  it("刷新状态时保留上一次的调试端口，但不持续显示刷新文字", () => {
    apiState.data = RUNNING_WITH_ENTRY;
    apiState.loading = true;
    renderBar();

    expect(screen.getByText("调试端口 9333")).toBeInTheDocument();
    expect(screen.queryByText("正在刷新")).not.toBeInTheDocument();
  });

  it("首次使用展开扫码提示，收起后记录偏好", () => {
    apiState.data = RUNNING_WITH_ENTRY;
    renderBar();
    expect(document.querySelector(".apply-browser-expanded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("browserStatus.hint.collapse") }));
    expect(document.querySelector(".apply-browser-compact")).toBeInTheDocument();
    expect(localStorage.getItem("resumeforge.apply.browser_hint_seen")).toBe("1");
  });

  it("错误态保留完整状态说明", () => {
    apiState.data = RUNNING_WITH_ENTRY;
    apiState.error = "status polling failed";
    renderBar();
    expect(document.querySelector(".apply-browser-compact")).toBeNull();
    expect(screen.getByText("首次使用请在弹出的浏览器窗口里扫码登录一次。")).toBeInTheDocument();
  });
});
