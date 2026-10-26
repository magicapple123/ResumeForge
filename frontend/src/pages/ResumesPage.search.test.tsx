// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心关键词搜索的**防抖**（QA R.02 观察项：此前只有 Enter 才发请求）。
 *
 * 从 `ResumesPage.test.tsx` 拆出：那条文件贴着 500 行预算，而本组用例要真实等待
 * 350ms 防抖；`vi.mock` 不跨文件 hoist，所以这里自带一份与 jobFilter 用例相同的脚手架。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
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

vi.mock("../components/resume/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));

const RESUME: ResumeBrief = {
  id: 8,
  title: "制造工程师岗位简历",
  job_id: null,
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

function renderPage(initialEntries: string[] = ["/resumes"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <ResumesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 已发出的列表请求里，最后一次带的关键词。 */
function lastKeyword(): unknown {
  const calls = apiMocks.listResumes.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as { keyword?: unknown }).keyword : undefined;
}

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(t("resumes.search.placeholder")) as HTMLInputElement;
}

beforeEach(() => {
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [RESUME], total: 1 });
  apiMocks.listResumeIds.mockReset().mockResolvedValue([RESUME.id]);
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
  apiMocks.batchDeleteResumes.mockReset().mockResolvedValue({ deleted: 2 });
  apiMocks.getResume.mockReset();
  apiMocks.fetchResumeHtml.mockReset();
  apiMocks.renderResume.mockReset();
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage 关键词搜索防抖", () => {
  it("输入停顿后自动发一次搜索请求（不必按 Enter）", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    fireEvent.change(searchInput(), { target: { value: "制造" } });

    await waitFor(() => expect(lastKeyword()).toBe("制造"), { timeout: 3000 });
    // 只提交最后一次：中间态不应各自发请求。
    const matched = apiMocks.listResumes.mock.calls.filter(
      (call) => (call[0] as { keyword?: string }).keyword === "制造",
    );
    expect(matched).toHaveLength(1);
  });

  it("快速连打只提交最后一次（中间态不出现在请求里）", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    const input = searchInput();
    fireEvent.change(input, { target: { value: "制" } });
    fireEvent.change(input, { target: { value: "制造" } });
    fireEvent.change(input, { target: { value: "制造工" } });

    await waitFor(() => expect(lastKeyword()).toBe("制造工"), { timeout: 3000 });
    const keywords = apiMocks.listResumes.mock.calls.map(
      (call) => (call[0] as { keyword?: string }).keyword,
    );
    expect(keywords).not.toContain("制");
    expect(keywords).not.toContain("制造");
  });

  it("Enter 立即生效：早于 350ms 防抖就发出请求", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    fireEvent.change(searchInput(), { target: { value: "制造" } });
    fireEvent.keyDown(searchInput(), { key: "Enter" });

    // 预算 300ms < 防抖 350ms：只有 Enter 立即提交才能在这之前命中。
    await waitFor(() => expect(lastKeyword()).toBe("制造"), { timeout: 300 });
  });

  it("清空（× / 退格到空）立即清筛选，不等防抖", async () => {
    renderPage(["/resumes?keyword=%E5%88%B6%E9%80%A0"]);
    await waitFor(() => expect(lastKeyword()).toBe("制造"), { timeout: 3000 });

    fireEvent.change(searchInput(), { target: { value: "" } });

    // 同样用 300ms 预算证明"立即"，而不是 350ms 后的防抖提交。
    await waitFor(() => expect(lastKeyword()).toBe(""), { timeout: 300 });
  });

  it("防抖应用搜索时回到第 1 页（不留在旧的页码上）", async () => {
    renderPage(["/resumes?page=2"]);
    await waitFor(
      () =>
        expect(apiMocks.listResumes).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
      { timeout: 3000 },
    );

    fireEvent.change(searchInput(), { target: { value: "制造" } });

    await waitFor(
      () =>
        expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
          expect.objectContaining({ keyword: "制造", page: 1 }),
        ),
      { timeout: 3000 },
    );
  });
});
