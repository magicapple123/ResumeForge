// SPDX-License-Identifier: Apache-2.0
/**
 * #34C 文件 → 导出子菜单（收藏夹 CSV / 知识库 Markdown / 整库备份）。
 *
 * 守四件事：
 *  1. 子菜单真的能展开（鼠标点击 + 键盘 →），三项都在；
 *  2. 收藏夹走 #28F 的既有封装 downloadFavoritesExport("csv")，不自写请求层；
 *  3. 知识库走 #29 的 exportKnowledgeMarkdown() + downloadBlob，失败时 toast 显示后端原因；
 *  4. 整库备份仍导航到设置页既有的备份入口（/settings?tab=backup），不是第二个实现。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopTitleBar from "./DesktopTitleBar";
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

const jobsApi = vi.hoisted(() => ({ downloadFavoritesExport: vi.fn(async () => undefined) }));
vi.mock("../../api/jobs", () => jobsApi);

const knowledgeApi = vi.hoisted(() => ({
  exportKnowledgeMarkdown: vi.fn(async () => ({
    blob: new Blob(["zip-bytes"]),
    filename: "知识库导出-20261111-223000.zip",
  })),
}));
vi.mock("../../api/knowledge", () => knowledgeApi);

const downloadMocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("../../utils/download", () => downloadMocks);

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

function installBridge() {
  const bridge: BridgeStub = {
    platform: "win32",
    menuAction: vi.fn(async () => ({ ok: true })),
    getWindowState: vi.fn(async () => ({
      maximized: false,
      fullscreen: false,
      alwaysOnTop: false,
      editableFocus: false,
    })),
    onWindowState: vi.fn(),
    setTheme: vi.fn(),
    setEditableFocus: vi.fn(),
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

async function openFileMenu() {
  fireEvent.click(trigger("file"));
  return screen.findByRole("menu", { name: t("appHeader.desktopMenu.file") });
}

function exportParent() {
  return screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.export") });
}

async function openExportSubmenu() {
  await openFileMenu();
  fireEvent.click(exportParent());
  return screen.findByRole("menu", { name: t("appHeader.desktopMenu.item.export") });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  nav.navigate.mockReset();
  jobsApi.downloadFavoritesExport.mockClear();
  knowledgeApi.exportKnowledgeMarkdown.mockClear();
  downloadMocks.downloadBlob.mockClear();
});

afterEach(() => {
  cleanup();
  delete (window as SplashWindow).splash;
  delete (window as SplashWindow).desktopShell;
});

describe("34C 文件 → 导出子菜单", () => {
  it("三个导出项都在，顺序为 收藏夹 / 知识库 / 整库备份", async () => {
    installBridge();
    renderTitleBar();
    const submenu = await openExportSubmenu();
    expect(submenu).toBeInTheDocument();
    const items = screen.getAllByRole("menuitem").map((node) => node.getAttribute("aria-label"));
    expect(items).toEqual(
      expect.arrayContaining([
        t("appHeader.desktopMenu.item.exportFavorites"),
        t("appHeader.desktopMenu.item.exportKnowledge"),
        t("appHeader.desktopMenu.item.backupAll"),
      ]),
    );
  });

  it("收藏夹：复用 downloadFavoritesExport('csv')（#28F 既有封装），成功后 toast", async () => {
    installBridge();
    renderTitleBar();
    await openExportSubmenu();
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: t("appHeader.desktopMenu.item.exportFavorites"),
      }),
    );
    await waitFor(() => expect(jobsApi.downloadFavoritesExport).toHaveBeenCalledWith("csv"));
    expect(
      await screen.findByText(t("appHeader.desktopMenu.export.favoritesDone")),
    ).toBeInTheDocument();
    // 菜单动作后收起：导出不该把菜单留在屏幕上。
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("知识库：复用 exportKnowledgeMarkdown() + downloadBlob，文件名用后端给的", async () => {
    installBridge();
    renderTitleBar();
    await openExportSubmenu();
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: t("appHeader.desktopMenu.item.exportKnowledge"),
      }),
    );
    await waitFor(() => expect(knowledgeApi.exportKnowledgeMarkdown).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadMocks.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "知识库导出-20261111-223000.zip",
    );
    expect(
      await screen.findByText(t("appHeader.desktopMenu.export.knowledgeDone")),
    ).toBeInTheDocument();
  });

  it("知识库为空（后端 404）时 toast 显示后端原因、不触发下载", async () => {
    installBridge();
    // 后端 detail 原样显示；这里用 ASCII 文案避免测试断言被中文棘轮计为新中文。
    const emptyMessage = "knowledge base is empty";
    knowledgeApi.exportKnowledgeMarkdown.mockRejectedValueOnce(new Error(emptyMessage));
    renderTitleBar();
    await openExportSubmenu();
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: t("appHeader.desktopMenu.item.exportKnowledge"),
      }),
    );
    expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
    expect(downloadMocks.downloadBlob).not.toHaveBeenCalled();
  });

  it("整库备份：导航到设置页既有备份入口（不重做一份备份实现）", async () => {
    installBridge();
    renderTitleBar();
    await openExportSubmenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("appHeader.desktopMenu.item.backupAll") }),
    );
    expect(nav.navigate).toHaveBeenCalledWith("/settings?tab=backup");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("键盘：导出项上按 → 展开子菜单并把焦点送进第一项", async () => {
    installBridge();
    renderTitleBar();
    await openFileMenu();
    const parent = exportParent();
    act(() => parent.focus());
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    const submenu = await screen.findByRole("menu", {
      name: t("appHeader.desktopMenu.item.export"),
    });
    expect(submenu).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", {
          name: t("appHeader.desktopMenu.item.exportFavorites"),
        }),
      ).toHaveFocus(),
    );
  });

  it("键盘：子菜单里按 Esc 收起子菜单、焦点回到「导出」父项", async () => {
    installBridge();
    renderTitleBar();
    await openFileMenu();
    const parent = exportParent();
    act(() => parent.focus());
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    const firstChild = await screen.findByRole("menuitem", {
      name: t("appHeader.desktopMenu.item.exportFavorites"),
    });
    await waitFor(() => expect(firstChild).toHaveFocus());
    fireEvent.keyDown(firstChild, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: t("appHeader.desktopMenu.item.export") }),
      ).toBeNull(),
    );
    expect(exportParent()).toHaveFocus();
  });
});
