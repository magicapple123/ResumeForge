// SPDX-License-Identifier: Apache-2.0
/**
 * CR-33 折叠视图的页面级验收：同一岗位多版本时折成一行、展开后能选到具体版本。
 *
 * 这里只断言"用户看得见的事实"：行标题带版本数、投递次数来自后端聚合、
 * 展开后每一版都有自己的收藏按钮。分组口径本身在 `resumeGroups.test.ts` 里测。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeBrief } from "../types";
import ResumesPage from "./ResumesPage";
import { EXPANDED_GROUPS_KEY } from "../features/resume/list/expandedGroups";

const apiMocks = vi.hoisted(() => ({
  deleteResume: vi.fn(),
  batchDeleteResumes: vi.fn(),
  listResumes: vi.fn(),
  listResumeIds: vi.fn(),
  updateResumeFavorite: vi.fn(),
  getResume: vi.fn(),
  fetchResumePreviewHtml: vi.fn(),
  renderResume: vi.fn(),
}));

vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  deleteResume: apiMocks.deleteResume,
  batchDeleteResumes: apiMocks.batchDeleteResumes,
  listResumes: apiMocks.listResumes,
  listResumeIds: apiMocks.listResumeIds,
  updateResumeFavorite: apiMocks.updateResumeFavorite,
  getResume: apiMocks.getResume,
  fetchResumePreviewHtml: apiMocks.fetchResumePreviewHtml,
  renderResume: apiMocks.renderResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

vi.mock("../features/resume/preview/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));

function brief(overrides: Partial<ResumeBrief> & { id: number }): ResumeBrief {
  return {
    title: `简历 ${overrides.id}`,
    job_id: null,
    job_title: "",
    company: "星海智能",
    source: "manual",
    favorite: false,
    note: "",
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
    ...overrides,
  };
}

const JOB = "前沿部署工程师";

/** 同一岗位 3 个版本 + 1 份通用简历：应折成 2 行。 */
const ITEMS: ResumeBrief[] = [
  brief({
    id: 1,
    title: `${JOB}-v1`,
    job_id: 17,
    job_title: JOB,
    delivery_count: 4,
    updated_at: "2026-11-01T08:00:00",
  }),
  brief({
    id: 2,
    title: `${JOB}-v2`,
    job_id: 17,
    job_title: JOB,
    delivery_count: 4,
    updated_at: "2026-11-20T08:00:00",
  }),
  brief({
    id: 3,
    title: `${JOB}-v3`,
    job_id: 17,
    job_title: JOB,
    delivery_count: 4,
    updated_at: "2026-11-10T08:00:00",
  }),
  brief({ id: 4, title: "通用简历", job_id: null, job_title: "软件开发" }),
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/resumes"]}>
      <AntdApp>
        <ResumesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: ITEMS, total: ITEMS.length });
  apiMocks.listResumeIds.mockReset().mockResolvedValue(ITEMS.map((item) => item.id));
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
  apiMocks.batchDeleteResumes.mockReset().mockResolvedValue({ deleted: 0 });
  apiMocks.getResume.mockReset();
  apiMocks.fetchResumePreviewHtml.mockReset();
  apiMocks.renderResume.mockReset();
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage 版本堆叠（CR-33）", () => {
  it("同一岗位的 3 个版本折成一行，行上给出最近更新与投递次数", async () => {
    renderPage();

    expect(
      await screen.findByText(t("resumes.list.group.title", { job: JOB, count: 3 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("resumes.list.group.delivery", { count: 4 }))).toBeInTheDocument();
    // 通用简历不是任何岗位的版本，各自成行（标题与「通用简历」标签各出现一次）。
    expect(screen.getAllByText(t("resumes.list.general")).length).toBeGreaterThan(0);
    // 折叠态下版本标题不单独占一行（只在展开区出现）。
    expect(screen.queryByRole("button", { name: /-v1$/ })).toBeNull();
  });

  it("展开后能逐版操作：每一版都有自己的收藏按钮", async () => {
    renderPage();
    fireEvent.click(await screen.findByText(t("resumes.list.group.title", { job: JOB, count: 3 })));

    // 版本行按更新时间倒序：v2（11-20）→ v3（11-10）→ v1（11-01）。
    const titles = await screen.findAllByRole("button", { name: /-v\d$/ });
    expect(titles.map((node) => node.textContent)).toEqual([`${JOB}-v2`, `${JOB}-v3`, `${JOB}-v1`]);
    // 展开区里每一版一个收藏按钮；组行本身没有「整组收藏」这种动作。
    expect(screen.getAllByRole("button", { name: t("resumes.list.favoriteAdd") })).toHaveLength(3);
    // 展开状态按 `.v1` 键持久化。
    await waitFor(() =>
      expect(window.localStorage.getItem(EXPANDED_GROUPS_KEY)).toContain("job:17"),
    );
  });

  it("只在有同岗位多版本时才折叠；全是不重复的记录时保持平铺", async () => {
    const flatTitles = ["简历 A", "简历 B"];
    const flat = flatTitles.map((title, index) => brief({ id: index + 1, title }));
    apiMocks.listResumes.mockResolvedValue({ items: flat, total: flat.length });
    renderPage();

    expect(await screen.findByText(flatTitles[0]!)).toBeInTheDocument();
    expect(screen.getByText(flatTitles[1]!)).toBeInTheDocument();
    expect(screen.queryByText(t("resumes.list.group.title", { job: JOB, count: 3 }))).toBeNull();
  });
});
