// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面菜单 #34 的补强项（34E / 34A / 34F / 34G / 34H）在真实标题栏里的接线。
 *
 * 与 DesktopTitleBar.test.tsx 的分工：那边守 §19 的既有交互（六个菜单、开合、键盘、
 * 主题、全屏），这里只守本轮新增的菜单项与它们的**状态来源**：
 *  - 34E 视图 → 重新加载 / 开发者工具（Ctrl+R / F12）；
 *  - 34A 窗口 → 置顶：勾选态来自窗口实态，且每次打开菜单前重新读；
 *  - 34F 撤销/重做：焦点不在可编辑区时置灰；
 *  - 34G 关闭窗口带 Alt+F4 加速键（真正拦下来，不只是写展示文本）；
 *  - 34H 检查更新只留在「关于」里。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopTitleBar from "./DesktopTitleBar";
import { OPEN_JOB_IMPORT_EVENT } from "./desktopJobImport";
import { t } from "../../i18n";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => nav.navigate };
});

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
    platform: string;
    alwaysOnTop: boolean;
    editableFocus: boolean;
    menuAction: (action: string) => Promise<{ ok: boolean; result?: unknown }>;
  }> = {},
) {
  // 主进程的实态：模成"窗口与渲染层上报的状态"，而不是一个固定返回值——菜单打开前
  // 会重新读一次快照，固定返回值会让"用回执纠正勾选"的用例自相矛盾。
  let windowAlwaysOnTop = overrides.alwaysOnTop ?? false;
  let reportedEditableFocus = overrides.editableFocus ?? false;
  bridge = {
    platform: overrides.platform ?? "win32",
    menuAction: vi.fn(
      overrides.menuAction ??
        (async (action: string) => {
          if (action === "window.toggleAlwaysOnTop") {
            windowAlwaysOnTop = !windowAlwaysOnTop;
            return { ok: true, result: { alwaysOnTop: windowAlwaysOnTop } };
          }
          return { ok: true };
        }),
    ),
    getWindowState: vi.fn(async () => ({
      maximized: false,
      fullscreen: false,
      alwaysOnTop: windowAlwaysOnTop,
      editableFocus: reportedEditableFocus,
    })),
    onWindowState: vi.fn(),
    setTheme: vi.fn(),
    setEditableFocus: vi.fn((value: boolean) => {
      reportedEditableFocus = value;
    }),
  };
  (window as SplashWindow).splash = { isDesktop: true, quitApp: vi.fn() };
  (window as SplashWindow).desktopShell = bridge;
  return bridge;
}

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

function trigger(id: string) {
  return screen.getByRole("menuitem", { name: t(`appHeader.desktopMenu.${id}` as never) });
}

async function openMenu(id: string) {
  fireEvent.click(trigger(id));
  return screen.findByRole("menu", { name: t(`appHeader.desktopMenu.${id}` as never) });
}

function item(nameKey: string) {
  return screen.getByRole("menuitem", { name: t(nameKey as never) });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  nav.navigate.mockReset();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  delete (window as SplashWindow).splash;
  delete (window as SplashWindow).desktopShell;
});

describe("34E 视图 → 重新加载 / 开发者工具", () => {
  it("菜单里有两项，点击分别发 view.reload / view.toggleDevTools", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("view");
    expect(item("appHeader.desktopMenu.item.reload")).toBeInTheDocument();
    expect(item("appHeader.desktopMenu.item.toggleDevTools")).toBeInTheDocument();

    fireEvent.click(item("appHeader.desktopMenu.item.reload"));
    expect(bridge.menuAction).toHaveBeenCalledWith("view.reload");

    await openMenu("view");
    fireEvent.click(item("appHeader.desktopMenu.item.toggleDevTools"));
    expect(bridge.menuAction).toHaveBeenCalledWith("view.toggleDevTools");
  });

  it("Ctrl+R 重新加载、F12 开发者工具（自绘菜单替代默认菜单后补回来的加速键）", () => {
    installBridge();
    renderTitleBar();
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(bridge.menuAction).toHaveBeenCalledWith("view.reload");
    fireEvent.keyDown(window, { key: "F12" });
    expect(bridge.menuAction).toHaveBeenCalledWith("view.toggleDevTools");
    // 刷新走的是主进程 reload，不能让渲染层顺手把路由重置回首页。
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it("开发者工具项展示 F12 快捷键提示", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("view");
    expect(screen.getByText("F12")).toBeInTheDocument();
  });
});

describe("34A 窗口 → 置顶", () => {
  it("勾选态来自窗口实态（打开菜单时读到的 alwaysOnTop=true 就是勾上）", async () => {
    installBridge({ alwaysOnTop: true });
    renderTitleBar();
    await openMenu("window");
    const check = screen.getByRole("menuitemcheckbox", {
      name: t("appHeader.desktopMenu.item.alwaysOnTop"),
    });
    await waitFor(() => expect(check).toHaveAttribute("aria-checked", "true"));
  });

  it("每次打开菜单前重新读一次实态（窗口被外部改过时勾选态跟着变）", async () => {
    installBridge();
    renderTitleBar();
    bridge.getWindowState.mockResolvedValue({
      maximized: false,
      fullscreen: false,
      alwaysOnTop: true,
      editableFocus: false,
    });
    await openMenu("window");
    const check = screen.getByRole("menuitemcheckbox", {
      name: t("appHeader.desktopMenu.item.alwaysOnTop"),
    });
    await waitFor(() => expect(check).toHaveAttribute("aria-checked", "true"));
  });

  it("点击后发 window.toggleAlwaysOnTop，并用主进程回执的实态更新勾选", async () => {
    installBridge({ alwaysOnTop: false });
    renderTitleBar();
    await openMenu("window");
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", {
        name: t("appHeader.desktopMenu.item.alwaysOnTop"),
      }),
    );
    expect(bridge.menuAction).toHaveBeenCalledWith("window.toggleAlwaysOnTop");
    await openMenu("window");
    const check = screen.getByRole("menuitemcheckbox", {
      name: t("appHeader.desktopMenu.item.alwaysOnTop"),
    });
    // 勾选来自主进程回执（本用例的 stub 在动作里真的翻转了窗口实态），而不是
    // 渲染层自己翻的状态——否则会出现"菜单说置顶了、窗口其实没置顶"。
    await waitFor(() => expect(check).toHaveAttribute("aria-checked", "true"));
  });
});

describe("34F 撤销 / 重做置灰", () => {
  it("焦点不在可编辑区时撤销、重做都禁用", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("edit");
    expect(item("appHeader.desktopMenu.item.undo")).toBeDisabled();
    expect(item("appHeader.desktopMenu.item.redo")).toBeDisabled();
  });

  it("焦点在输入框里时可用，且把焦点状态报给主进程（IPC 同源）", async () => {
    installBridge();
    renderTitleBar();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    try {
      act(() => textarea.focus());
      await waitFor(() => expect(bridge.setEditableFocus).toHaveBeenCalledWith(true));
      await openMenu("edit");
      expect(item("appHeader.desktopMenu.item.undo")).toBeEnabled();
      expect(item("appHeader.desktopMenu.item.redo")).toBeEnabled();
    } finally {
      textarea.remove();
    }
  });

  it("O3：鼠标按在菜单项上不抢焦点（mousedown 被 preventDefault）", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("edit");
    const cut = item("appHeader.desktopMenu.item.cut");
    // fireEvent 返回 false = 事件被 preventDefault：按钮不接管 DOM 焦点。
    expect(fireEvent.mouseDown(cut)).toBe(false);
  });

  it("O3：执行编辑命令前把焦点还给输入框（菜单点撤销不是 no-op）", async () => {
    installBridge();
    renderTitleBar();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    try {
      act(() => textarea.focus());
      await waitFor(() => expect(bridge.setEditableFocus).toHaveBeenCalledWith(true));
      await openMenu("edit");
      const undo = item("appHeader.desktopMenu.item.undo");
      // 模拟真实 Chromium 的焦点转移：菜单项获得焦点（这正是命令 no-op 的原因）。
      act(() => undo.focus());
      expect(document.activeElement).toBe(undo);
      fireEvent.click(undo);
      expect(bridge.menuAction).toHaveBeenCalledWith("edit.undo");
      // 执行前已把焦点还给输入框——webContents.undo() 才会作用在它身上。
      expect(document.activeElement).toBe(textarea);
    } finally {
      textarea.remove();
    }
  });

  it("点开菜单（焦点进标题栏）不改变可编辑判断——撤销不会一开菜单就变灰", async () => {
    installBridge();
    renderTitleBar();
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      act(() => input.focus());
      await waitFor(() => expect(bridge.setEditableFocus).toHaveBeenCalledWith(true));
      await openMenu("edit");
      trigger("edit").focus();
      expect(item("appHeader.desktopMenu.item.undo")).toBeEnabled();
    } finally {
      input.remove();
    }
  });
});

describe("34B 文件 → 从链接导入岗位", () => {
  it("跳岗位广场并向页面上的同一个 launcher 发打开事件（不另挂一套弹窗）", async () => {
    installBridge();
    renderTitleBar();
    const listener = vi.fn();
    window.addEventListener(OPEN_JOB_IMPORT_EVENT, listener);
    try {
      await openMenu("file");
      // 文案复用岗位上那个按钮的 key：同一个动作不造第二套说法。
      fireEvent.click(item("jobsImport.launcher"));
      expect(nav.navigate).toHaveBeenCalledWith("/jobs");
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_JOB_IMPORT_EVENT, listener);
    }
  });
});

describe("34D 复制诊断信息", () => {
  it("帮助 → 复制诊断信息：取主进程报告 + 补设置 + 写剪贴板 + toast", async () => {
    installBridge({
      menuAction: async (action: string) => {
        if (action === "help.getDiagnostics") {
          return {
            ok: true,
            result: {
              version: "9.9.9",
              platform: "win32",
              dataDir: "D:/data",
              logDir: "D:/logs",
              problems: ["[desktop-main.log] WARN backend slow"],
            },
          };
        }
        return { ok: true };
      },
    });
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      renderTitleBar();
      await openMenu("help");
      fireEvent.click(item("appHeader.desktopMenu.item.copyDiagnostics"));
      await waitFor(() => expect(bridge.menuAction).toHaveBeenCalledWith("help.getDiagnostics"));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const text = writeText.mock.calls[0][0] as string;
      expect(text).toContain("9.9.9");
      expect(text).toContain("D:/logs");
      expect(text).toContain("[desktop-main.log]");
      // 反证：模型配置的掩码串与密钥都不许出现在复制件里。
      expect(text).not.toContain("********");
      expect(text).not.toContain("sk-");
      expect(
        await screen.findByText(t("appHeader.desktopMenu.diagnostics.copied")),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
});

describe("34G / 34H 关闭窗口与检查更新", () => {
  it("关闭窗口展示 Alt+F4 并真的用 Alt+F4 关闭窗口", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("window");
    expect(screen.getByText("Alt+F4")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "F4", altKey: true });
    expect(bridge.menuAction).toHaveBeenCalledWith("window.close");
  });

  it("macOS 上关闭窗口展示 ⌘W，并用 ⌘W 触发", async () => {
    installBridge({ platform: "darwin" });
    renderTitleBar();
    await openMenu("window");
    const closeItem = item("appHeader.desktopMenu.item.closeWindow");
    expect(closeItem.textContent).toContain("⌘W");
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(bridge.menuAction).toHaveBeenCalledWith("window.close");
  });

  it("帮助菜单里不再有「检查更新」，它只在「关于」弹窗里（34H）", async () => {
    installBridge();
    renderTitleBar();
    await openMenu("help");
    expect(
      screen.queryByRole("menuitem", { name: t("appHeader.desktopMenu.about.checkUpdate") }),
    ).toBeNull();

    fireEvent.click(trigger("about"));
    await screen.findByRole("menu", { name: t("appHeader.desktopMenu.about") });
    fireEvent.click(screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.about.title") }));
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: t("appHeader.desktopMenu.about.checkUpdate") }),
    );
    expect(bridge.menuAction).toHaveBeenCalledWith("help.checkUpdate");
  });
});
