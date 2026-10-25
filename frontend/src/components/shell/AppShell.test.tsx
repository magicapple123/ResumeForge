// SPDX-License-Identifier: Apache-2.0
/**
 * A04：外壳的**空闲预热**（首屏稳定后分批 preload 页面 chunk）。
 *
 * 审计缺口只有一条："AppShell 空闲预热失败不污染控制台"没有测试。这里补两条性质：
 *
 * 1. 预热失败**不产生未处理 rejection、不往控制台写错误**——那条链路没有任何调用方 await，
 *    漏一个 `.catch` 就是一条没人处理的 rejection（最坏的情况是整页白屏或测试进程报错）；
 * 2. 预热成功后重复调用（悬停侧栏 / 点击导航）**不重复加载**——`lazyPage` 的 promise
 *    缓存必须真的被走到，否则每 hover 一次就是一个新请求。
 *
 * 页面模块全部用桩：本文件验的是"调度与接线"，不是 18 个页面的渲染。断言文案来自
 * `navigationConfig` 常量，不写字面量中文（`cjkRatchet` 的 tests 口径）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell";
import { PRIMARY_NAVIGATION_ITEMS } from "../navigation/navigationConfig";

/**
 * 页面注册表桩：与真的 `lazyPage` 一样"同一加载窗口只执行一次 factory"。
 *
 * `preloadCalls` 数的是**被调用了几次**，`loads` 数的是**真的加载了几次**：
 * 前者随悬停增长是允许的，后者增长才是"重复下载 chunk"。
 */
const registryMock = vi.hoisted(() => {
  const pageNames = [
    "HomePage",
    "JobsPage",
    "ProfilePage",
    "ClaimsPage",
    "DrillPage",
    "ResumesPage",
    "ApplyPage",
    "WebFormPage",
    "TrackerPage",
    "FavoritesPage",
    "AssistantPage",
    "MaterialsPage",
    "KnowledgePage",
    "SkillsPage",
    "InterviewPage",
    "AnalyticsPage",
    "SettingsPage",
    "TrashPage",
  ] as const;
  const preloadCalls = new Map<string, number>();
  const loads = new Map<string, number>();
  const failures = new Map<string, Error>();
  const pending = new Map<string, Promise<{ default: () => null }>>();
  const pages: Record<string, { preload: () => Promise<{ default: () => null }> }> = {};

  for (const name of pageNames) {
    pages[name] = {
      preload: () => {
        preloadCalls.set(name, (preloadCalls.get(name) ?? 0) + 1);
        const failure = failures.get(name);
        if (failure) return Promise.reject(failure);
        // 与真的 `lazyPage` 同一条：同一加载窗口只执行一次 factory。
        let promise = pending.get(name);
        if (!promise) {
          loads.set(name, (loads.get(name) ?? 0) + 1);
          promise = Promise.resolve({ default: () => null });
          pending.set(name, promise);
        }
        return promise;
      },
    };
  }

  return {
    pages,
    pageNames,
    preloadCalls,
    loads,
    failures,
    reset() {
      preloadCalls.clear();
      loads.clear();
      failures.clear();
      pending.clear();
    },
  };
});

vi.mock("../../pages/registry", () => registryMock.pages);
vi.mock("../../pages/modals", () => ({ UserGuideModal: () => null }));
vi.mock("../AppHeaderActions", () => ({ default: () => null }));
vi.mock("../common/AnnouncementBar", () => ({ default: () => null }));
vi.mock("../BackgroundTaskBar", () => ({ default: () => null }));
vi.mock("../StarPromptModal", () => ({ default: () => null }));
vi.mock("../RiskScanWatcher", () => ({ default: () => null }));
vi.mock("../SuggestionScanWatcher", () => ({ default: () => null }));
vi.mock("../TaskCompletionNotifier", () => ({ default: () => null }));
vi.mock("../GlobalOverlays", () => ({ default: () => null }));
vi.mock("../navigation/MobileNavigation", () => ({ default: () => null }));
vi.mock("../navigation/RouteAccessibility", () => ({ default: () => null }));
vi.mock("../../features/announcements/useUpdateAnnouncement", () => ({
  useUpdateAnnouncement: () => undefined,
}));
vi.mock("../../features/ai-polish/AiPolishLayer", () => ({ default: () => null }));
vi.mock("../../features/shortcuts/ShortcutProvider", () => ({ default: () => null }));
vi.mock("../../features/shortcuts/useAppShortcuts", () => ({ useAppShortcuts: () => undefined }));
vi.mock("../../features/tou-tou/TouTouProvider", () => ({
  TouTouProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../features/tou-tou/TouTouOrb", () => ({ default: () => null }));
vi.mock("../../features/tou-tou/TouTouAssistantCard", () => ({ default: () => null }));
vi.mock("../../features/tou-tou/TouTouClipboardCard", () => ({ default: () => null }));
vi.mock("../../hooks/useNavigationVisibility", () => ({
  useNavigationVisibility: () => ({ hiddenKeys: [], loading: false }),
}));
vi.mock("../../hooks/useResponsiveShell", () => ({
  useResponsiveShell: () => ({ collapsed: false }),
}));
vi.mock("../../utils/taskNotify", () => ({ registerTaskNavigate: vi.fn() }));
vi.mock("../../utils/userGuide", () => ({
  consumeFirstVisitGuide: () => false,
  setUserGuideVisible: vi.fn(),
}));

/** jsdom 没有 requestIdleCallback 时 AppShell 走 200ms 的 setTimeout 回退；显式钉死这条路径。 */
function stubIdleFallback(): void {
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.stubGlobal("cancelIdleCallback", undefined);
}

function renderShell() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** 首屏 800ms + 每批 200ms（18 个 chunk / 3 个一批）。 */
async function warmAll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

function menu(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".app-nav-menu");
  if (!node) throw new Error("sidebar menu not rendered");
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubIdleFallback();
  registryMock.reset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppShell · 空闲预热（A04）", () => {
  it("预热失败：不产生未处理 rejection，也不往控制台写错误", async () => {
    const failure = new Error("chunk load failed");
    registryMock.failures.set("HomePage", failure);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    const nodeProcess = (
      globalThis as unknown as {
        process?: {
          on: (event: string, listener: (reason: unknown) => void) => void;
          off: (event: string, listener: (reason: unknown) => void) => void;
        };
      }
    ).process;
    nodeProcess?.on("unhandledRejection", onUnhandled);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      renderShell();
      await warmAll();

      // 失败的那一个真的被尝试过（否则这条用例什么都没证明）。
      expect(registryMock.preloadCalls.get("HomePage")).toBe(1);
      expect(unhandled).toEqual([]);
      const mentionsFailure = [...consoleError.mock.calls, ...consoleWarn.mock.calls].some((args) =>
        args.some((arg) => String(arg).includes(failure.message)),
      );
      expect(mentionsFailure).toBe(false);
    } finally {
      nodeProcess?.off("unhandledRejection", onUnhandled);
    }
  });

  it("预热成功后悬停/点击导航复用同一份加载，不重复加载 chunk", async () => {
    renderShell();
    await warmAll();
    // 18 个页面各预热一次。
    for (const name of registryMock.pageNames) {
      expect(registryMock.preloadCalls.get(name)).toBe(1);
      expect(registryMock.loads.get(name)).toBe(1);
    }

    const home = PRIMARY_NAVIGATION_ITEMS[0];
    fireEvent.mouseEnter(within(menu()).getByText(home.label));
    fireEvent.click(within(menu()).getByText(home.label));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // 调用可以重复（悬停 + 点击各一次），但底层加载只有一次。
    expect(registryMock.preloadCalls.get("HomePage")).toBe(3);
    expect(registryMock.loads.get("HomePage")).toBe(1);
    expect(screen.getAllByText(home.label).length).toBeGreaterThan(0);
  });
});
