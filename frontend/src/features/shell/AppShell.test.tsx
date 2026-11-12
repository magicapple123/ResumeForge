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
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell";
import { t } from "../../i18n";
import { getViewRefreshVersion, resetViewRefreshForTests } from "./viewRefresh";
import { PRIMARY_NAVIGATION_ITEMS } from "./navigationConfig";

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
    "ExternalResumesPage",
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
vi.mock("./AppHeaderActions", () => ({ default: () => null }));
vi.mock("../../components/common/AnnouncementBar", () => ({ default: () => null }));
vi.mock("./BackgroundTaskBar", () => ({ default: () => null }));
vi.mock("./StarPromptModal", () => ({ default: () => null }));
vi.mock("./TaskCompletionNotifier", () => ({ default: () => null }));
vi.mock("./GlobalOverlays", () => ({ default: () => null }));
vi.mock("./MobileNavigation", () => ({ default: () => null }));
vi.mock("./RouteAccessibility", () => ({ default: () => null }));
vi.mock("../announcements/useUpdateAnnouncement", () => ({
  useUpdateAnnouncement: () => undefined,
}));
vi.mock("../ai-polish/AiPolishLayer", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutProvider", () => ({ default: () => null }));
vi.mock("../shortcuts/useAppShortcuts", () => ({ useAppShortcuts: () => undefined }));
vi.mock("../tou-tou/TouTouProvider", () => ({
  TouTouProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../tou-tou/TouTouOrb", () => ({ default: () => null }));
vi.mock("../tou-tou/TouTouAssistantCard", () => ({ default: () => null }));
vi.mock("../tou-tou/TouTouClipboardCard", () => ({ default: () => null }));
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

/** 当前路由的快照（`AppShell` 自己不渲染路由内容，跳转只能用这种方式观测）。 */
function PathProbe() {
  const { pathname } = useLocation();
  return <span data-testid="path">{pathname}</span>;
}

function renderShellAt(path: string) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
        <PathProbe />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** 侧栏品牌图标按钮（手势的唯一落点）。 */
function brandMark(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".app-brand-mark-button");
  if (!node) throw new Error("brand mark button not rendered");
  return node;
}

function currentPath(): string {
  return screen.getByTestId("path").textContent ?? "";
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
  resetViewRefreshForTests();
  // jsdom 没实现 window.scrollTo：默认桩掉，免得每次点击都往控制台写 "Not implemented"。
  vi.stubGlobal("scrollTo", vi.fn());
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
    fireEvent.mouseEnter(within(menu()).getByText(t(home.labelKey)));
    fireEvent.click(within(menu()).getByText(t(home.labelKey)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // 调用可以重复（悬停 + 点击各一次），但底层加载只有一次。
    expect(registryMock.preloadCalls.get("HomePage")).toBe(3);
    expect(registryMock.loads.get("HomePage")).toBe(1);
    expect(screen.getAllByText(t(home.labelKey)).length).toBeGreaterThan(0);
  });
});

/**
 * 品牌图标手势（P5-1 / P5-2 / P5-3 · 13-1·13-2·13-3）。
 *
 * 断言的数字口径：刷新用 `viewRefresh` 的版本号计数（等于"广播了几次"），
 * 跳转用 `PathProbe` 读真实 pathname。文案一律走 `t()` / `tShellGesture()`，
 * 不写字面量（`cjkRatchet` 的 tests 口径）。
 */
describe("AppShell · 品牌图标手势（P5-1 / P5-2 / P5-3）", () => {
  it("单击立刻回顶部，且不触发刷新", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    renderShellAt("/tracker");

    fireEvent.click(brandMark());
    // 单击的滚动是**立即**的：不能被 400ms 结算窗口拖慢。
    expect(scrollTo).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(getViewRefreshVersion()).toBe(0);
  });

  it("双击在 400ms 静默结算后只广播一次刷新", async () => {
    renderShellAt("/tracker");
    const button = brandMark();

    fireEvent.click(button);
    fireEvent.click(button);
    // 静默窗口内先不刷：用户可能还要点第三下，提前刷新会白跑一轮请求。
    expect(getViewRefreshVersion()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(getViewRefreshVersion()).toBe(1);

    // 结算之后不会再多刷一次。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getViewRefreshVersion()).toBe(1);
  });

  it('三击回首页：从别的页面跳到 "/"，不等静默窗口', async () => {
    renderShellAt("/tracker");
    const button = brandMark();

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(currentPath()).toBe("/");
    expect(getViewRefreshVersion()).toBe(0);
  });

  it("已经在首页时三击等价于刷新（pathname 不变，广播 +1）", async () => {
    renderShellAt("/");
    const button = brandMark();

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(currentPath()).toBe("/");
    expect(getViewRefreshVersion()).toBe(1);
  });

  it("品牌图标不再有手势提示：hover 后无浮层，aria-label 仍只描述单击", async () => {
    renderShellAt("/");

    await act(async () => {
      fireEvent.mouseEnter(brandMark());
      await vi.advanceTimersByTimeAsync(600);
    });

    // 手势是彩蛋（#22）：hover 不该出现任何浮层。这条是反向断言——
    // 谁把 Tooltip 加回来，它会立刻变红。全局延迟 0.6s，等满 600ms 仍为空才算数。
    expect(document.querySelector(".ant-tooltip")).toBeNull();
    expect(brandMark().getAttribute("aria-label")).toBe(t("navigation.shell.scrollTop"));
  });
});
