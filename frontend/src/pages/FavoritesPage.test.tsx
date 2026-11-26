// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { expectNoUnfocusableScroller } from "../test/a11yScrollRegion";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import FavoritesPage from "./FavoritesPage";

const apiMocks = vi.hoisted(() => ({
  listFavoriteJobs: vi.fn(),
  updateJob: vi.fn(),
  batchFavoriteJobs: vi.fn(),
  downloadFavoritesExport: vi.fn(),
  addToQueue: vi.fn(),
  // T31：简历页签改走 `GET /api/favorites`（一次返回内部 + 外部两种 kind）。
  listFavoriteResumes: vi.fn(),
  updateResumeFavorite: vi.fn(),
  setExternalResumeFavorite: vi.fn(),
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));

// #28：收藏夹岗位页签改用专用端点（带生命周期徽标与「已投/未投」筛选）。
vi.mock("../api/jobs", () => ({
  listFavoriteJobs: apiMocks.listFavoriteJobs,
  updateJob: apiMocks.updateJob,
  batchFavoriteJobs: apiMocks.batchFavoriteJobs,
  downloadFavoritesExport: apiMocks.downloadFavoritesExport,
}));
vi.mock("../api/apply", () => ({
  addToQueue: apiMocks.addToQueue,
}));
// 展开真实模块再覆盖：显式列导出时，生产代码新增一个导出就会让调用方直接抛
// "export is not defined"，看起来像组件崩了。
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  updateResumeFavorite: apiMocks.updateResumeFavorite,
  getResume: vi.fn(),
  fetchResumePreviewHtml: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));
// T31：收藏页同时消费两条简历链路——内部（`updateResumeFavorite`）与外部
// （`setExternalResumeFavorite`）。外部详情弹层的取数也在这里挡住，测试不联网。
vi.mock("../api/favorites", () => ({
  listFavoriteResumes: apiMocks.listFavoriteResumes,
}));
vi.mock("../api/externalResumes", () => ({
  setExternalResumeFavorite: apiMocks.setExternalResumeFavorite,
  getExternalResume: apiMocks.getExternalResume,
  getExternalResumeAnalysis: apiMocks.getExternalResumeAnalysis,
  externalResumeFileUrl: apiMocks.externalResumeFileUrl,
}));

beforeEach(() => {
  apiMocks.listFavoriteJobs.mockReset().mockResolvedValue({
    items: [
      {
        id: 1,
        title: "数据分析师",
        company: "示例公司",
        location: "上海",
        posted_at: "2026-08-20",
        status: "开放中",
        favorite: true,
        favorited_at: "2026-11-01T10:00:00",
        favorited_at_estimated: false,
        applied: false,
        queued: false,
        keywords: [],
        note: "",
      },
    ],
    total: 1,
  });
  // T31：简历页签的数据是两种 kind 的并集（内部 `internal:2` + 外部 `external:7`）。
  // 外部那条的文件名用 ASCII：`cjkRatchet` 的 tests 口径只降不升。
  apiMocks.listFavoriteResumes.mockReset().mockResolvedValue({
    items: [
      {
        kind: "internal",
        id: 2,
        ref: "internal:2",
        title: "数据分析岗位简历",
        job_title: "数据分析师",
        company: "示例公司",
        source: "ai",
        mime: "",
        file_id: null,
        note: "",
        text_chars: null,
        has_text: null,
        favorite: true,
        favorited_at: "2026-08-20T10:00:00",
        favorited_at_estimated: false,
        created_at: "2026-08-20T10:00:00",
        updated_at: "2026-08-20T10:00:00",
      },
      {
        kind: "external",
        id: 7,
        ref: "external:7",
        title: "Client version.pdf",
        job_title: "数据分析师",
        company: "示例公司",
        source: "",
        mime: "application/pdf",
        file_id: 99,
        note: "",
        text_chars: 830,
        has_text: true,
        favorite: true,
        favorited_at: "2026-11-02T10:00:00",
        favorited_at_estimated: false,
        created_at: "2026-11-02T10:00:00",
        updated_at: "2026-11-02T10:00:00",
      },
    ],
    total: 2,
  });
  apiMocks.updateJob.mockReset().mockResolvedValue({});
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.setExternalResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.getExternalResume.mockReset().mockResolvedValue({
    id: 7,
    file_id: 99,
    name: "Client version.pdf",
    mime: "application/pdf",
    text_chars: 830,
    has_text: true,
    job_id: null,
    job_title: "",
    favorite: true,
    favorited_at: "2026-11-02T10:00:00",
    note: "",
    created_at: "2026-11-02T10:00:00",
    updated_at: "2026-11-02T10:00:00",
    warnings: [],
    text: "body",
  });
  apiMocks.getExternalResumeAnalysis.mockReset().mockResolvedValue({
    resume_id: 7,
    text_chars: 830,
    line_count: 12,
    estimated_pages: 1,
    has_text: true,
    checks: [],
    warnings: [],
  });
  apiMocks.batchFavoriteJobs.mockReset().mockResolvedValue({ updated: 1, skipped: [] });
  apiMocks.downloadFavoritesExport.mockReset().mockResolvedValue(undefined);
  apiMocks.addToQueue.mockReset().mockResolvedValue([]);
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
    expect(apiMocks.listFavoriteJobs).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "favorited_desc" }),
    );

    fireEvent.click(screen.getByText("简历"));
    expect(await screen.findByText("数据分析岗位简历")).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.listFavoriteResumes).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, page_size: 10 }),
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
    const button = screen.getByRole("button", { name: t("favorites.action.unfavorite") });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(apiMocks.updateJob).toHaveBeenCalledWith(1, { favorite: false }));
    expect(apiMocks.updateJob).toHaveBeenCalledOnce();
    await waitFor(() => expect(apiMocks.listFavoriteJobs).toHaveBeenCalledTimes(2));
  });

  it("removes a resume favorite through the resume API", async () => {
    /** 某一行里的星星按钮（整表按行定位：两条按钮的可访问名相同）。 */
    const starOf = (title: string) =>
      within(screen.getByText(title).closest("tr") as HTMLElement).getByRole("button", {
        name: t("favorites.action.unfavorite"),
      });

    renderPage();
    fireEvent.click(await screen.findByText("简历"));
    await screen.findByText("数据分析岗位简历");

    // 内部行 → `PATCH /api/resumes/{id}/favorite`。
    fireEvent.click(starOf("数据分析岗位简历"));

    await waitFor(() => expect(apiMocks.updateResumeFavorite).toHaveBeenCalledWith(2, false));
    await waitFor(() => expect(apiMocks.listFavoriteResumes).toHaveBeenCalledTimes(2));
    // 写库期间整表星星是禁用的，等这一轮结束后再点下一行（否则点击会被守卫吞掉）。
    await waitFor(() => expect(starOf("数据分析岗位简历")).toBeEnabled());

    // 外部行 → `PATCH /api/external-resumes/{id}/favorite`（T28 的写入口）。
    fireEvent.click(starOf("Client version.pdf"));

    await waitFor(() => expect(apiMocks.setExternalResumeFavorite).toHaveBeenCalledWith(7, false));
    await waitFor(() => expect(apiMocks.listFavoriteResumes).toHaveBeenCalledTimes(3));
  });

  it("labels internal vs external rows and opens the matching detail", async () => {
    renderPage(["/favorites?kind=resumes"]);
    // 行的 `data-row-key` 就是复合引用（`internal:2` / `external:7`）：两种 kind 的 id
    // 会撞号，所以按 ref 取行，不按数字 id——这同时钉住了 rowKey 的口径。
    await waitFor(() =>
      expect(document.querySelector('tr[data-row-key="external:7"]')).not.toBeNull(),
    );
    const externalRow = document.querySelector('tr[data-row-key="external:7"]') as HTMLElement;
    const internalRow = document.querySelector('tr[data-row-key="internal:2"]') as HTMLElement;

    expect(within(externalRow).getByText(t("favorites.kind.external"))).toBeInTheDocument();
    expect(within(internalRow).getByText(t("favorites.kind.internal"))).toBeInTheDocument();

    // 点外部那行 → 外部详情（`getExternalResume`），不会误开内部同号简历。
    fireEvent.click(within(externalRow).getByText("Client version.pdf"));
    await waitFor(() => expect(apiMocks.getExternalResume).toHaveBeenCalledWith(7));
    // 内部简历的详情走的是另一条取数（`getResume`），不该被这次点击触发。
    expect(apiMocks.getExternalResume).toHaveBeenCalledTimes(1);
  });

  it("jumps to the existing external hub deep link from the row menu", async () => {
    // 深链口径是既有的 `/resumes/external?resume=<id>`（T13 在用），收藏页不新造路由：
    // 这里把目标路由换成一个 stub，断言"确实跳过去了"而不是"打开了某个弹层"。
    render(
      <MemoryRouter initialEntries={["/favorites?kind=resumes"]}>
        <AntdApp>
          <Routes>
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/resumes/external" element={<div data-testid="external-hub" />} />
          </Routes>
        </AntdApp>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('tr[data-row-key="external:7"]')).not.toBeNull(),
    );
    const row = document.querySelector('tr[data-row-key="external:7"]') as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(await screen.findByText(t("favorites.action.openInHub")));

    expect(await screen.findByTestId("external-hub")).toBeInTheDocument();
  });

  it("shows an update error and allows the user to retry", async () => {
    apiMocks.updateJob.mockRejectedValueOnce(new Error("收藏服务暂时不可用"));
    renderPage();
    await screen.findByText("数据分析师");

    fireEvent.click(screen.getByRole("button", { name: t("favorites.action.unfavorite") }));
    expect(await screen.findByText("收藏服务暂时不可用")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: t("favorites.action.unfavorite") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: t("favorites.action.unfavorite") }));

    await waitFor(() => expect(apiMocks.updateJob).toHaveBeenCalledTimes(2));
  });

  it("从 URL 恢复页签（简历页签直接打开）", async () => {
    renderPage(["/favorites?kind=resumes"]);

    // URL 指定 resumes 时直接落在简历页签上，而不是先渲染岗位再切换。
    expect(await screen.findByText("数据分析岗位简历")).toBeInTheDocument();
    expect(apiMocks.listFavoriteResumes).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 10 }),
    );
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
    apiMocks.listFavoriteJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
    apiMocks.listFavoriteResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
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
