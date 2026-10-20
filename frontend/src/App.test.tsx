// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import pkg from "../package.json";
import { APP_NAME, GITHUB_REPO } from "./config";

vi.mock("./pages/HomePage", () => ({ default: () => <div>首页内容</div> }));
vi.mock("./pages/JobsPage", () => ({ default: () => <div>岗位广场内容</div> }));
vi.mock("./pages/ProfilePage", () => ({ default: () => <div>我的资料内容</div> }));
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("first-visit guide", () => {
  it("opens automatically once and remains available from the sidebar", async () => {
    const firstRender = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog", { name: "欢迎使用简历通" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "稍后查看" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    firstRender.unmount();

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("首页内容");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "使用指南" }));
    expect(await screen.findByRole("dialog", { name: "欢迎使用简历通" })).toBeInTheDocument();
  });
});

describe("application navigation", () => {
  it("lets keyboard users skip navigation and focus the current page", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByText("首页内容");

    const skip = screen.getByRole("link", { name: "跳到主要内容" });
    fireEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
    expect(skip).toHaveAttribute("href", `#${screen.getByRole("main").id}`);
  });

  it("opens mobile navigation, follows a destination and closes the drawer", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const toggle = await screen.findByRole("button", { name: "打开导航" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const drawer = await screen.findByRole("dialog", { name: "功能导航" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(drawer).getByRole("menuitem", { name: "岗位广场" }));
    expect(await screen.findByText("岗位广场内容")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "功能导航" })).toBeNull());
    expect(screen.getByRole("main")).toHaveFocus();
    expect(document.title).toBe(`岗位广场 · ${APP_NAME}`);
  });

  it("shows the app version next to the brand name, matching package.json", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // 版本号单源是根 package.json 的 version（CI 与后端 config.py 一起核对），
    // 页头品牌区展示的必须是同一个值：以 v 开头、hover 有 title 说明。
    const version = container.querySelector(".app-brand-version");
    expect(version).not.toBeNull();
    expect(version!.textContent).toMatch(/^v/);
    expect(version!.textContent).toBe(`v${pkg.version}`);
    expect(version).toHaveAttribute("title", "当前版本");
  });

  it("opens private pages from the top-level 我的空间 menu", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /我的空间/ }));
    fireEvent.click(await screen.findByText("收藏夹"));
    expect(await screen.findByText("收藏夹内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /我的空间/ }));
    fireEvent.click(screen.getByText("求职助手"));
    expect(await screen.findByText("求职助手内容")).toBeInTheDocument();
  });

  it("keeps the open-source link in the header actions, not in the sidebar footer", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // 入口走过三个位置：页头右上角的一行文字（太抢注意力）→ 侧栏左下角图标（要找到底部）
    // → 页头右上角图标（与「退出」并排，符合"关于本项目"这类入口的习惯）。
    // 这条断言钉住的是**位置**，不是"存在"——只断言存在的话，挪到哪里都能过。
    const headerActions = container.querySelector(".app-header-actions");
    expect(headerActions).not.toBeNull();
    const repoLink = headerActions?.querySelector(".app-repo-button");
    expect(repoLink).not.toBeNull();
    expect(repoLink).toHaveAttribute("href", GITHUB_REPO);
    expect(repoLink).toHaveAttribute("aria-label", `在 GitHub 上查看 ${APP_NAME} 源码`);
    // 页头里必须和「退出」并排，且页脚不再有第二个源码入口。
    expect(headerActions?.textContent).toContain("退出");
    expect(container.querySelector(".app-sider-footer .app-repo-button")).toBeNull();

    // 点击除直跳仓库外，还要弹出 Star 提示（Modal 挂在 document.body 上）。
    fireEvent.click(repoLink!);
    expect(await screen.findByText(/点一个 Star/)).toBeInTheDocument();
    // 带 href 的 antd Button 渲染成 <a>，角色是 link。
    expect(screen.getByRole("link", { name: "去点 Star" })).toHaveAttribute("href", GITHUB_REPO);
  });

  it("shows the theme switch in the header actions", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    window.localStorage.setItem("rf.theme", "light");
    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // A3：主题三档从设置页搬到页头（原「全局模型选择器」的位置）。
    const theme = await screen.findByRole("radiogroup", { name: "主题" });
    const headerActions = container.querySelector(".app-header-actions");
    expect(headerActions?.contains(theme)).toBe(true);
    expect(screen.getByTitle("深色")).toBeInTheDocument();
  });

  it("clicking the ResumeForge icon scrolls the current page to the top", async () => {
    window.localStorage.setItem("resumeforge.user-guide.seen", "1");
    const scrollTo = vi.fn();
    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <App />
      </MemoryRouter>,
    );

    const scroller = document.querySelector<HTMLElement>(".app-main");
    expect(scroller).not.toBeNull();
    scroller!.scrollTo = scrollTo;
    fireEvent.click(await screen.findByRole("button", { name: "回到当前页面顶部" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    // 页面是懒加载的（`lazy()` + Suspense），这里必须等它解析出来：用 getByText 的话
    // 成败取决于"这一拍跑得够不够快"——本机过、CI 的慢机器挂（2026-10-01 红过一次）。
    expect(await screen.findByText("岗位广场内容")).toBeInTheDocument();
  });
});
