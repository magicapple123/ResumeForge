// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoUnfocusableScroller } from "../test/a11yScrollRegion";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import FavoritesPage from "./FavoritesPage";

const apiMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  updateJob: vi.fn(),
  listResumes: vi.fn(),
  updateResumeFavorite: vi.fn(),
}));

vi.mock("../api/jobs", () => ({
  listJobs: apiMocks.listJobs,
  updateJob: apiMocks.updateJob,
}));
// 展开真实模块再覆盖：显式列导出时，生产代码新增一个导出就会让调用方直接抛
// "export is not defined"，看起来像组件崩了。
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  listResumes: apiMocks.listResumes,
  updateResumeFavorite: apiMocks.updateResumeFavorite,
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

beforeEach(() => {
  apiMocks.listJobs.mockReset().mockResolvedValue({
    items: [
      {
        id: 1,
        title: "数据分析师",
        company: "示例公司",
        location: "上海",
        posted_at: "2026-08-20",
        favorite: true,
      },
    ],
    total: 1,
  });
  apiMocks.listResumes.mockReset().mockResolvedValue({
    items: [
      {
        id: 2,
        title: "数据分析岗位简历",
        job_id: 1,
        job_title: "数据分析师",
        company: "示例公司",
        source: "ai",
        favorite: true,
        model: "test-model",
        enhancement_enabled: false,
        enhancement_level: "balanced",
        created_at: "2026-08-20T10:00:00",
      },
    ],
    total: 1,
  });
  apiMocks.updateJob.mockReset().mockResolvedValue({});
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderPage(initialEntries: string[] = ["/favorites"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <FavoritesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

describe("FavoritesPage", () => {
  it("loads only favorites and switches between jobs and resumes", async () => {
    renderPage();

    expect(await screen.findByText("数据分析师")).toBeInTheDocument();
    expect(apiMocks.listJobs).toHaveBeenCalledWith(expect.objectContaining({ favorite: true }));

    fireEvent.click(screen.getByText("简历"));
    expect(await screen.findByText("数据分析岗位简历")).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenCalledWith(
        expect.objectContaining({ favorite: true }),
      ),
    );
  });

  it("简历页签不强制横向滚动，去掉多余滚动条", async () => {
    renderPage();
    await screen.findByText("数据分析师");

    // 岗位页签列更宽，仍保留横向滚动兜底（scroll.x 会挂上 ant-table-scroll-horizontal）。
    // 该类加在表格外层容器上，不在 <table> 上。
    expect(
      document.querySelector(".ant-table")?.classList.contains("ant-table-scroll-horizontal"),
    ).toBe(true);

    fireEvent.click(screen.getByText("简历"));
    await screen.findByText("数据分析岗位简历");

    // 简历页签列更窄，去掉 scroll.x 后不再出现用不上的横向滚动条。
    expect(
      document.querySelector(".ant-table")?.classList.contains("ant-table-scroll-horizontal"),
    ).toBe(false);
  });

  it("removes a job favorite once and reloads the filtered list", async () => {
    renderPage();
    await screen.findByText("数据分析师");
    const button = screen.getByRole("button", { name: "取消收藏" });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(apiMocks.updateJob).toHaveBeenCalledWith(1, { favorite: false }));
    expect(apiMocks.updateJob).toHaveBeenCalledOnce();
    await waitFor(() => expect(apiMocks.listJobs).toHaveBeenCalledTimes(2));
  });

  it("removes a resume favorite through the resume API", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("简历"));
    await screen.findByText("数据分析岗位简历");

    fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));

    await waitFor(() => expect(apiMocks.updateResumeFavorite).toHaveBeenCalledWith(2, false));
    await waitFor(() => expect(apiMocks.listResumes).toHaveBeenCalledTimes(2));
  });

  it("shows an update error and allows the user to retry", async () => {
    apiMocks.updateJob.mockRejectedValueOnce(new Error("收藏服务暂时不可用"));
    renderPage();
    await screen.findByText("数据分析师");

    fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));
    expect(await screen.findByText("收藏服务暂时不可用")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "取消收藏" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));

    await waitFor(() => expect(apiMocks.updateJob).toHaveBeenCalledTimes(2));
  });

  it("从 URL 恢复页签（简历页签直接打开）", async () => {
    renderPage(["/favorites?kind=resumes"]);

    // URL 指定 resumes 时直接落在简历页签上，而不是先渲染岗位再切换。
    expect(await screen.findByText("数据分析岗位简历")).toBeInTheDocument();
    expect(apiMocks.listResumes).toHaveBeenCalledWith(expect.objectContaining({ favorite: true }));
  });
});

/**
 * 横向滚动区（C-20 收尾核验）。
 *
 * 岗位页签带 `scroll={{ x: 760 }}`，antd 因此把表格放进带 `overflow-x: auto` 的
 * `.ant-table-content`，但那个容器**没有 tabindex**。收藏为空时区内没有任何可聚焦
 * 元素（空态只有一句说明），窄窗 / 200% 缩放下容器收窄到 760px 以下就会命中 axe 的
 * `scrollable-region-focusable`（WCAG 2.1.1，serious）——键盘用户滚不到也进不去。
 *
 * jsdom 不算布局，规则本身在单测里命不中，所以这里跟 JobTable / ResumeTable 一样按结构
 * 钉住：空收藏时那个滚动容器要么不存在，要么能被 Tab 到（判定逻辑见
 * `src/test/a11yScrollRegion.ts`）。
 */
describe("FavoritesPage 空收藏的横向滚动区（a11y）", () => {
  beforeEach(() => {
    apiMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
    apiMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  /**
   * 等首屏请求落地：加载中 antd 渲染转圈占位，加载完才换成空态，两者 DOM 不同。
   * 按结构等（`.ant-table-placeholder`），不按中文文案——`cjkRatchet` 的 tests 口径
   * 只降不升，新增用例不该再引入中文 `ByText` 断言。
   */
  async function waitForEmptyTable() {
    await waitFor(() => expect(document.querySelector(".ant-table-placeholder")).not.toBeNull());
  }

  it("岗位页签空收藏：不产生「可横滚、区内却无可聚焦元素」的容器（axe scrollable-region-focusable）", async () => {
    renderPage();
    await waitForEmptyTable();

    expectNoUnfocusableScroller(document);
  });

  it("简历页签没有 scroll.x，空收藏时本来就没有横向滚动区（对照组）", async () => {
    renderPage(["/favorites?kind=resumes"]);
    await waitForEmptyTable();

    const content = document.querySelector<HTMLElement>(".ant-table-content");
    expect(content?.style.overflowX).toBe("");
    expect(
      document.querySelector(".ant-table")?.classList.contains("ant-table-scroll-horizontal"),
    ).toBe(false);
  });
});
