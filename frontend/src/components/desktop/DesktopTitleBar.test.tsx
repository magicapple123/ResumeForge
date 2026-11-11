// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面自绘标题栏（问题清单 §19.8「渲染层」）：六个菜单、点击展开、Esc / 点外部关闭、
 * 已展开时悬停切换、Alt 聚焦菜单栏、键盘上下选、动作经固定 id 交给主进程、
 * 深色主题同步、全屏隐藏、浏览器里不渲染。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopTitleBar from "./DesktopTitleBar";
import { DESKTOP_MENUS } from "./desktopMenuModel";
import { OPEN_USER_GUIDE_EVENT } from "./desktopShellBridge";
import { t } from "../../i18n";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => nav.navigate };
});

// 主题拉取 + #34D 诊断信息用到的四个只读接口：它们是模块级依赖（DEFAULT_LOADERS），
// 必须在 mock 工厂里一起给出来，否则模块在 import 期就取不到导出。
const settingsApi = vi.hoisted(() => ({
  getGlobalTheme: vi.fn(async () => ({ theme: "light" })),
  saveGlobalTheme: vi.fn(async () => undefined),
  getLLMConfig: vi.fn(async () => ({
    provider: "deepseek",
    base_url: "https://api.example.com",
    api_key: "********",
    model: "deepseek-chat",
    api_style: "openai",
  })),
  getReminderPopupSetting: vi.fn(async () => ({ enabled: true })),
  getWebFormRelaxedMode: vi.fn(async () => ({ enabled: false })),
  getAssistantRelaxedMode: vi.fn(async () => ({ enabled: false })),
}));
vi.mock("../../api/settings", () => settingsApi);

interface BridgeStub {
  platform: string;
  menuAction: ReturnType<typeof vi.fn>;
  getWindowState: ReturnType<typeof vi.fn>;
  onWindowState: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  setEditableFocus: ReturnType<typeof vi.fn>;
}

type SplashWindow = Window & {
  splash?: { isDesktop?: boolean; quitApp?: () => void };
  desktopShell?: BridgeStub;
};

let bridge: BridgeStub;

function installBridge(
  overrides: Partial<{
    maximized: boolean;
    fullscreen: boolean;
    platform: string;
    alwaysOnTop: boolean;
    editableFocus: boolean;
  }> = {},
) {
  bridge = {
    platform: overrides.platform ?? "win32",
    menuAction: vi.fn(async (action: string) => {
      if (action === "about.getInfo") {
        return { ok: true, result: { version: "9.9.9", platform: "win32" } };
      }
      return { ok: true };
    }),
    getWindowState: vi.fn(async () => ({
      maximized: overrides.maximized ?? false,
      fullscreen: overrides.fullscreen ?? false,
      alwaysOnTop: overrides.alwaysOnTop ?? false,
      editableFocus: overrides.editableFocus ?? false,
    })),
    onWindowState: vi.fn(),
    setTheme: vi.fn(),
    setEditableFocus: vi.fn(),
  };
  (window as SplashWindow).splash = { isDesktop: true, quitApp: vi.fn() };
  (window as SplashWindow).desktopShell = bridge;
  return bridge;
}

// 标题栏用 App.useApp() 弹 toast（#34D 复制诊断信息），测试必须包 <AntdApp>。
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AntdApp>
      <MemoryRouter>{children}</MemoryRouter>
    </AntdApp>
  );
}

function renderTitleBar() {
  return render(<DesktopTitleBar />, { wrapper: Wrapper });
}

function menuTrigger(id: string) {
  return screen.getByRole("menuitem", { name: t(`appHeader.desktopMenu.${id}` as never) });
}

async function openMenu(id: string) {
  fireEvent.click(menuTrigger(id));
  return screen.findByRole("menu", { name: t(`appHeader.desktopMenu.${id}` as never) });
}

beforeEach(() => {
  localStorage.clear();
  nav.navigate.mockReset();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  delete (window as SplashWindow).splash;
  delete (window as SplashWindow).desktopShell;
});

describe("DesktopTitleBar", () => {
  it("六个菜单按顺序渲染，且标签是纯文字（没有 (F) 这类字母）", () => {
    installBridge();
    renderTitleBar();
    const labels = DESKTOP_MENUS.map((menu) => t(menu.labelKey));
    for (const label of labels) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(labels.join("")).not.toMatch(/\([A-Z]\)/);
  });

  it("浏览器（没有 splash 桥）不渲染标题栏", () => {
    const { container } = render(
      <MemoryRouter>
        <DesktopTitleBar />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("点击「文件」展开菜单；点「新建简历…」走路由跳转并收起菜单", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("file");
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.newResume") }),
    );
    expect(nav.navigate).toHaveBeenCalledWith("/resumes");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 关闭菜单并把焦点还给触发按钮", async () => {
    installBridge();
    renderTitleBar();
    fireEvent.click(menuTrigger("file"));
    const dropdown = await screen.findByRole("menu");
    expect(dropdown).toBeInTheDocument();
    const trigger = menuTrigger("file");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("点击菜单外关闭；窗口失焦 / 内容区滚动也关闭", async () => {
    installBridge();
    renderTitleBar();

    fireEvent.click(menuTrigger("file"));
    await screen.findByRole("menu");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(menuTrigger("file"));
    await screen.findByRole("menu");
    fireEvent.blur(window);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(menuTrigger("file"));
    await screen.findByRole("menu");
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("已展开时悬停另一个菜单直接切换（不用再点一次）", async () => {
    installBridge();
    renderTitleBar();
    fireEvent.click(menuTrigger("file"));
    await screen.findByRole("menu", { name: t("appHeader.desktopMenu.file") });

    fireEvent.mouseEnter(menuTrigger("edit"));
    const editMenu = await screen.findByRole("menu", { name: t("appHeader.desktopMenu.edit") });
    expect(editMenu).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.undo") }),
    ).toBeInTheDocument();
  });

  it("Alt 把焦点交给菜单栏；方向键切菜单、上下选项、Enter 执行", async () => {
    installBridge();
    renderTitleBar();
    fireEvent.keyDown(window, { key: "Alt" });
    expect(menuTrigger("file")).toHaveFocus();

    fireEvent.keyDown(menuTrigger("file"), { key: "ArrowRight" });
    expect(menuTrigger("edit")).toHaveFocus();

    // 打开「编辑」并把焦点送进第一项。撤销/重做在焦点不在可编辑区时是灰的（#34F），
    // 键盘导航从第一个**可用**项开始——这是置灰要真的生效，而不是只改颜色。
    fireEvent.keyDown(menuTrigger("edit"), { key: "ArrowDown" });
    const firstItem = await screen.findByRole("menuitem", {
      name: t("appHeader.desktopMenu.item.cut"),
    });
    await waitFor(() => expect(firstItem).toHaveFocus());

    fireEvent.keyDown(firstItem, { key: "ArrowDown" });
    const copyItem = screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.copy") });
    expect(copyItem).toHaveFocus();

    fireEvent.click(copyItem);
    expect(bridge.menuAction).toHaveBeenCalledWith("edit.copy");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Enter 打开菜单后方向键能进入条目（焦点不卡在触发按钮上）", async () => {
    installBridge();
    renderTitleBar();
    const trigger = menuTrigger("file");
    trigger.focus();
    fireEvent.click(trigger); // 键盘 Enter 在原生 button 上就是 click
    await screen.findByRole("menu", { name: t("appHeader.desktopMenu.file") });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const firstItem = screen.getByRole("menuitem", {
      name: t("appHeader.desktopMenu.item.newResume"),
    });
    expect(firstItem).toHaveFocus();
  });

  it("「窗口 → 关闭窗口」交给主进程的 window.close 动作（复用第 18 条 handler）", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("window");
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.closeWindow") }),
    );
    expect(bridge.menuAction).toHaveBeenCalledWith("window.close");
  });

  it("窗口已最大化时「最大化」变成「还原」", async () => {
    installBridge({ maximized: true });
    renderTitleBar();
    await act(async () => undefined);
    await openMenu("window");
    expect(
      screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.restore") }),
    ).toBeInTheDocument();
  });

  it("主题切换把实际生效的深浅色同步给主进程（覆盖层按钮颜色）", async () => {
    installBridge();
    renderTitleBar();
    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith("light"));

    const { setThemeMode } = await import("../../features/theme/themeStore");
    await act(async () => {
      setThemeMode("dark");
    });
    expect(bridge.setTheme).toHaveBeenCalledWith("dark");
  });

  it("「帮助 → 使用指南」派发窗口事件（AppShell 监听并打开引导弹窗）", async () => {
    installBridge();
    renderTitleBar();
    const listener = vi.fn();
    window.addEventListener(OPEN_USER_GUIDE_EVENT, listener);
    try {
      await openMenu("help");
      fireEvent.click(
        screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.guide") }),
      );
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_USER_GUIDE_EVENT, listener);
    }
  });

  it("「关于」与其它菜单一致：先展开下拉，点「关于简历通」才弹窗（#34I）", async () => {
    installBridge();
    renderTitleBar();
    fireEvent.click(menuTrigger("about"));
    const aboutMenu = await screen.findByRole("menu", { name: t("appHeader.desktopMenu.about") });
    expect(aboutMenu).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.about.title") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument();
    expect(bridge.menuAction).toHaveBeenCalledWith("about.getInfo");

    fireEvent.click(screen.getByRole("button", { name: t("appHeader.desktopMenu.about.github") }));
    expect(bridge.menuAction).toHaveBeenCalledWith("external.github");
  });

  it("快照误报 fullscreen=true 时仍然占位（P1-1：快照只用于菜单文案）", async () => {
    installBridge({ fullscreen: true });
    renderTitleBar();
    const bar = screen.getByTestId("desktop-titlebar");
    // 快照确实被读到了（否则这条用例会因为"没等到"而假绿），但它不能决定隐藏。
    await waitFor(() => expect(bridge.getWindowState).toHaveBeenCalled());
    expect(bar.getAttribute("data-hidden")).toBeNull();
  });

  it("全屏时标题栏隐藏（元素保留在 DOM，退出全屏的推送还收得到）", async () => {
    installBridge();
    renderTitleBar();
    const bar = screen.getByTestId("desktop-titlebar");
    expect(bar.getAttribute("data-hidden")).toBeNull();
    // 真实来源之一：Chromium 的文档级全屏事件。
    act(() => {
      document.dispatchEvent(new Event("enter-html-full-screen"));
    });
    await waitFor(() => expect(bar.getAttribute("data-hidden")).toBe("true"));
    act(() => {
      document.dispatchEvent(new Event("leave-html-full-screen"));
    });
    await waitFor(() => expect(bar.getAttribute("data-hidden")).toBeNull());
  });

  it("主进程推送全屏状态时同样隐藏（第二个真实来源）", async () => {
    const stub = installBridge();
    renderTitleBar();
    const bar = screen.getByTestId("desktop-titlebar");
    const push = stub.onWindowState.mock.calls[0]?.[0] as
      ((state: { maximized: boolean; fullscreen: boolean }) => void) | undefined;
    expect(typeof push).toBe("function");
    act(() => {
      push?.({ maximized: false, fullscreen: true });
    });
    await waitFor(() => expect(bar.getAttribute("data-hidden")).toBe("true"));
  });

  it("旧壳（只有 splash、没有 desktopShell）渲染 32px 纯占位条（P1-1 兜底）", () => {
    (window as SplashWindow).splash = { isDesktop: true, quitApp: vi.fn() };
    renderTitleBar();
    const placeholder = screen.getByTestId("desktop-titlebar-placeholder");
    expect(placeholder).toHaveClass("app-titlebar");
    // 占位条没有菜单：旧壳的菜单动作通道不存在，画出来也点不动。
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("macOS 平台：标题栏带红绿灯内边距修饰类", async () => {
    installBridge({ platform: "darwin" });
    renderTitleBar();
    const bar = screen.getByTestId("desktop-titlebar");
    expect(bar.className).toContain("app-titlebar--mac");
  });
});
