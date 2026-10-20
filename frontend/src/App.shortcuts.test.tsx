// SPDX-License-Identifier: Apache-2.0
/**
 * App 级快捷键验收（R5）：全局监听挂得住、输入框里的原生撤销不被劫持、
 * 保存落到页面自己的保存入口。
 *
 * 页面用 mock 顶掉（与本目录 App.test.tsx 同一套做法），其中「我的资料」那个 mock
 * 自己用 `useShortcut` 注册撤回/保存——正好验证"页面认领动作"这条链路。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

const shortcutSpies = vi.hoisted(() => ({ undo: vi.fn(), save: vi.fn() }));

vi.mock("./pages/HomePage", () => ({
  default: () => (
    <div>
      首页内容
      {/* antd 的 Input.Search 渲染出的内层 input 自带 type="search"。 */}
      <input type="search" aria-label="全站搜索" />
    </div>
  ),
}));
vi.mock("./pages/JobsPage", () => ({ default: () => <div>岗位广场内容</div> }));
vi.mock("./pages/ProfilePage", async () => {
  const { useShortcut } = await import("./features/shortcuts/useShortcutKeymap");
  function ProfilePageMock() {
    useShortcut("undo", shortcutSpies.undo);
    useShortcut("save", shortcutSpies.save);
    return (
      <div>
        我的资料内容
        <textarea aria-label="个人总结" />
      </div>
    );
  }
  return { default: ProfilePageMock };
});
vi.mock("./pages/ResumesPage", () => ({ default: () => <div>简历中心内容</div> }));
vi.mock("./pages/FavoritesPage", () => ({ default: () => <div>收藏夹内容</div> }));
vi.mock("./pages/AssistantPage", () => ({ default: () => <div>求职助手内容</div> }));
vi.mock("./pages/SettingsPage", () => ({ default: () => <div>设置内容</div> }));
vi.mock("./pages/ClaimsPage", () => ({ default: () => <div>事实台账内容</div> }));
vi.mock("./pages/DrillPage", () => ({ default: () => <div>事实核对内容</div> }));
vi.mock("./pages/ApplyPage", () => ({ default: () => <div>投递台内容</div> }));
vi.mock("./pages/WebFormPage", () => ({ default: () => <div>网申填表内容</div> }));
vi.mock("./pages/TrackerPage", () => ({ default: () => <div>求职进度内容</div> }));
vi.mock("./pages/MaterialsPage", () => ({ default: () => <div>资料箱内容</div> }));
vi.mock("./pages/KnowledgePage", () => ({ default: () => <div>知识库内容</div> }));
vi.mock("./pages/SkillsPage", () => ({ default: () => <div>工作台内容</div> }));
vi.mock("./pages/InterviewPage", () => ({ default: () => <div>模拟面试内容</div> }));
vi.mock("./pages/AnalyticsPage", () => ({ default: () => <div>求职统计内容</div> }));
vi.mock("./pages/TrashPage", () => ({ default: () => <div>回收站内容</div> }));

function renderApp(path: string) {
  window.localStorage.setItem("resumeforge.user-guide.seen", "1");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("App 快捷键", () => {
  it("mod+k 在任意页面唤起全站搜索（R6），不再跳回首页", async () => {
    renderApp("/jobs");
    expect(await screen.findByText("岗位广场内容")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    // 浮层直接出现在当前页面（T7：`role="search"` 的非模态面板）；输入框自动聚焦，
    // 用户可以直接打字。
    expect(await screen.findByRole("search", { name: "全站搜索" })).toBeInTheDocument();
    const input = screen.getByLabelText("搜索关键词");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByText("首页内容")).toBeNull();
  });

  it("输入框里的 mod+z 交给原生撤销，不拦截也不触发页面撤回", async () => {
    renderApp("/profile");
    await screen.findByText("我的资料内容");

    const textarea = screen.getByLabelText("个人总结");
    textarea.focus();
    // fireEvent 返回 false 表示事件被 preventDefault 了。
    const notPrevented = fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });

    expect(notPrevented).toBe(true);
    expect(shortcutSpies.undo).not.toHaveBeenCalled();
  });

  it("输入框外的 mod+z 触发页面的撤回，并拦掉浏览器默认行为", async () => {
    renderApp("/profile");
    await screen.findByText("我的资料内容");

    const notPrevented = fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(shortcutSpies.undo).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("mod+s 触发当前页面的保存入口（没有页面认领时不拦截）", async () => {
    renderApp("/profile");
    await screen.findByText("我的资料内容");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(shortcutSpies.save).toHaveBeenCalledTimes(1));

    // 换到没有注册保存的页面：事件不该被吞掉（浏览器自己的 Ctrl+S 仍然可用）。
    cleanup();
    renderApp("/jobs");
    await screen.findByText("岗位广场内容");
    expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(true);
    expect(shortcutSpies.save).toHaveBeenCalledTimes(1);
  });

  it("mod+j 打开并关闭浮窗求职助手", async () => {
    renderApp("/jobs");
    await screen.findByText("岗位广场内容");

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "投投求职助手" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "投投求职助手" })).toBeNull());
  });

  it("改过的组合立刻生效（localStorage → keymap）", async () => {
    window.localStorage.setItem(
      "rf.shortcuts.v1",
      JSON.stringify({ version: 1, bindings: { search: ["mod+p"] } }),
    );
    renderApp("/jobs");
    await screen.findByText("岗位广场内容");

    // 旧组合已失效：按 mod+k 打不开搜索弹层。
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByLabelText("搜索关键词")).toBeNull();

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(await screen.findByLabelText("搜索关键词")).toBeInTheDocument();
  });
});
