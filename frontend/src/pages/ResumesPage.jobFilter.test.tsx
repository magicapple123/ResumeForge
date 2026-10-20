// SPDX-License-Identifier: Apache-2.0
/**
 * 简历页的「按岗位筛选」（R15）：选岗位过滤 + URL 回写、清除只删 job_id、深链按 id 回查。
 *
 * 从 `ResumesPage.test.tsx` 拆出（行数预算 500）。`vi.mock` 不跨文件 hoist，
 * 所以这里自带一份 api mock 脚手架；用例名、注释与断言原样搬迁。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeBrief } from "../types";
import ResumesPage from "./ResumesPage";

const apiMocks = vi.hoisted(() => ({
  deleteResume: vi.fn(),
  batchDeleteResumes: vi.fn(),
  listResumes: vi.fn(),
  listResumeIds: vi.fn(),
  updateResumeFavorite: vi.fn(),
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
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
  fetchResumeHtml: apiMocks.fetchResumeHtml,
  renderResume: apiMocks.renderResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

// 预览主体是重渲染路径，由它自己的测试负责；本文件只关心筛选与 URL。
vi.mock("../components/resume/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

// 岗位筛选下拉会远程搜岗位，并按 id 回查已选岗位：两个端点都要桩掉。
const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));

const RESUME: ResumeBrief = {
  id: 8,
  title: "制造工程师岗位简历",
  job_id: 3,
  job_title: "制造工程师",
  company: "示例制造企业",
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
  created_at: "2026-08-20T10:00:00",
};

beforeEach(() => {
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [RESUME], total: 1 });
  apiMocks.listResumeIds.mockReset().mockResolvedValue([RESUME.id]);
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
  apiMocks.batchDeleteResumes.mockReset().mockResolvedValue({ deleted: 2 });
  apiMocks.getResume.mockReset().mockResolvedValue({
    ...RESUME,
    content: {},
    warnings: [],
    parse_error: "",
    rationale: "",
    coverage_notes: [],
  });
  apiMocks.fetchResumeHtml.mockReset().mockResolvedValue("<p>预览</p>");
  apiMocks.renderResume.mockReset().mockResolvedValue("<p>预览</p>");
  jobMocks.listJobs.mockReset().mockResolvedValue({
    items: [{ id: 3, title: "制造工程师", company: "示例制造企业" }],
    total: 1,
  });
  jobMocks.getJob.mockReset().mockResolvedValue({
    id: 3,
    title: "制造工程师",
    company: "示例制造企业",
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage 按岗位筛选（R15）", () => {
  function LocationProbe() {
    const location = useLocation();
    return <span data-testid="location">{location.pathname + location.search}</span>;
  }

  function renderPageWithProbe(initialEntries: string[]) {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <AntdApp>
          <ResumesPage />
          <LocationProbe />
        </AntdApp>
      </MemoryRouter>,
    );
  }

  /** 打开岗位下拉并选中第一条选项（远程搜索结果）。 */
  async function pickFirstJob() {
    const combobox = await screen.findByRole("combobox", { name: "按岗位筛选" });
    fireEvent.mouseDown(combobox);
    fireEvent.click(await screen.findByText("制造工程师 · 示例制造企业"));
  }

  it("选择岗位后按 job_id 过滤，并回到第 1 页", async () => {
    renderPageWithProbe(["/resumes"]);
    await screen.findByText(RESUME.title);

    await pickFirstJob();

    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ job_id: 3, page: 1 }),
      ),
    );
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("job_id=3");
    // 本页的 URL 约定是"page 只在 >1 时出现"，因此回到第一页表现为没有 page 参数。
    expect(location).not.toContain("page=");
  });

  it("清除只删 job_id，关键词与岗位关联筛选原样保留", async () => {
    renderPageWithProbe(["/resumes?job_id=3&keyword=%E5%88%B6%E9%80%A0&has_job=1"]);
    await screen.findByText(RESUME.title);

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("job_id"));
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("keyword=");
    expect(location).toContain("has_job=1");
    // 列表请求同样只剩关键词/关联条件（job_id 归 undefined）。
    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ job_id: undefined, keyword: "制造", has_job: true }),
      ),
    );
  });

  it("深链 ?job_id=：选项里没有这个岗位时按 id 回查名称", async () => {
    // 首页选项里没有 3 号岗位（岗位很多时深链指向的岗位常不在第一页）。
    jobMocks.listJobs.mockResolvedValue({
      items: [{ id: 7, title: "另一个岗位", company: "" }],
      total: 1,
    });
    jobMocks.getJob.mockResolvedValue({ id: 3, title: "已归档岗位", company: "" });
    renderPageWithProbe(["/resumes?job_id=3"]);

    expect(await screen.findByText("按岗位筛选：已归档岗位")).toBeInTheDocument();
    expect(jobMocks.getJob).toHaveBeenCalledWith(3);
  });

  it("岗位已不存在时降级显示 #id，筛选条件仍然生效", async () => {
    jobMocks.listJobs.mockResolvedValue({ items: [], total: 0 });
    jobMocks.getJob.mockRejectedValue(new Error("岗位不存在或已被删除"));
    renderPageWithProbe(["/resumes?job_id=3"]);

    await waitFor(() => expect(jobMocks.getJob).toHaveBeenCalledWith(3));
    expect(await screen.findByText("按岗位筛选：#3")).toBeInTheDocument();
    expect(apiMocks.listResumes).toHaveBeenLastCalledWith(expect.objectContaining({ job_id: 3 }));
  });
});
