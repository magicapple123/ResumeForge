// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心列头排序（T2）：从 `ResumesPage.test.tsx` 整段搬来（原文件 479 行贴预算），
 * 并按 v3 口径重写——排序入口从顶部下拉改成**列头三态 + 恢复默认按钮**。
 *
 * 断言的是"用户动作 → 请求参数"这条链：排序在服务端做，前端只负责把点击翻译成
 * `sort` 复合键，并让 URL/箭头与之一致。
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

// 展开真实模块再覆盖：显式列导出时，生产代码新增一个导出就会让调用方直接抛
// "export is not defined"，看起来像组件崩了。
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

// 详情预览是重渲染路径，由它自己的测试负责；这里只关心列表与排序。
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
  updated_at: "2026-08-21T09:30:00",
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderPage(initialEntries: string[] = ["/resumes"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <ResumesPage />
        <LocationProbe />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 点某列列头。表头标题在 antd 6 里会出现多份（测量/克隆节点），统一点 `<th>` 本体。 */
function clickHeader(label: string) {
  const title = screen.getAllByText(label)[0]!;
  const th = title.closest("th");
  expect(th).toBeTruthy();
  fireEvent.click(th as HTMLElement);
}

function header(label: string): HTMLElement {
  return screen.getAllByText(label)[0]!.closest("th") as HTMLElement;
}

beforeEach(() => {
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [RESUME], total: 1 });
  apiMocks.listResumeIds.mockReset().mockResolvedValue([RESUME.id]);
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
  apiMocks.batchDeleteResumes.mockReset().mockResolvedValue({ deleted: 1 });
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
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset().mockResolvedValue({ id: 3, title: "制造工程师" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage 列头排序（T2）", () => {
  it("默认按最近修改拉取，列头没有箭头，「恢复默认排序」禁用", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    expect(apiMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "updated_desc" }),
    );
    // 默认排序是接口不带参数时的行为，不是用户的选择：不给箭头、不写 URL。
    expect(header("最近修改").className).not.toContain("ant-table-column-sort");
    expect(screen.getByRole("button", { name: "恢复默认排序" })).toBeDisabled();
    expect(screen.getByTestId("location").textContent).not.toContain("sort=");
  });

  it("点「简历标题」→ 升序；再点 → 降序；第三次 → 回默认且箭头消失", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    clickHeader("简历标题");
    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "title_asc" }),
      ),
    );
    expect(header("简历标题").className).toContain("ant-table-column-sort");
    expect(screen.getByRole("button", { name: "恢复默认排序" })).toBeEnabled();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("sort=title_asc"));

    clickHeader("简历标题");
    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "title_desc" }),
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("sort=title_desc");

    // 第三次点击 = 取消排序。回到默认态：箭头消失、参数从 URL 消失。
    clickHeader("简历标题");
    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "updated_desc" }),
      ),
    );
    expect(header("简历标题").className).not.toContain("ant-table-column-sort");
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("sort="));
    expect(screen.getByRole("button", { name: "恢复默认排序" })).toBeDisabled();
  });

  it("「恢复默认排序」把非默认状态拉回最近修改在前", async () => {
    renderPage(["/resumes?sort=title_desc"]);
    await screen.findByText(RESUME.title);

    expect(apiMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "title_desc" }),
    );
    const reset = screen.getByRole("button", { name: "恢复默认排序" });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);

    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "updated_desc" }),
      ),
    );
    expect(header("简历标题").className).not.toContain("ant-table-column-sort");
    expect(reset).toBeDisabled();
  });

  it("深链 ?sort=title_desc：首屏请求与列头箭头一致", async () => {
    renderPage(["/resumes?sort=title_desc"]);
    await screen.findByText(RESUME.title);

    expect(apiMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "title_desc" }),
    );
    expect(header("简历标题").className).toContain("ant-table-column-sort");
  });

  it("旧下拉框的 sort 键（company_asc）不再发给后端，回落默认排序", async () => {
    // 以前是 `as ResumeSort` 硬转，`?sort=xxx` 会被原样发出换回 422。
    renderPage(["/resumes?sort=company_asc"]);
    await screen.findByText(RESUME.title);

    expect(apiMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "updated_desc" }),
    );
    expect(screen.getByRole("button", { name: "恢复默认排序" })).toBeDisabled();
  });

  it("排序变化时回到第 1 页（否则会停在新排序下不存在的页上）", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 40 });
    renderPage(["/resumes?page=3"]);
    await screen.findByText(RESUME.title);

    clickHeader("目标岗位");

    await waitFor(() =>
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "job_title_asc", page: 1 }),
      ),
    );
  });
});

describe("ResumesPage 列头提示（项 3）", () => {
  /**
   * 四列各有自己的提示，且只说"按什么排"：三态机制由表头箭头自解释，而"目标岗位 vs
   * 简历标题"这种易混列必须由文案交代语义（D3）。
   */
  it("四列提示分别是「按某列排序」，不再有三态说明", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    for (const label of ["简历标题", "目标岗位", "创建时间", "最近修改"]) {
      // 提示挂在列标题节点上（antd 把 column.title 包进 Tooltip），hover 它才会出现。
      const trigger = (header(label).querySelector(".ant-table-column-title") ??
        header(label)) as HTMLElement;
      fireEvent.mouseEnter(trigger);
      expect(await screen.findByText(`按${label}排序`)).toBeInTheDocument();
      fireEvent.mouseLeave(trigger);
    }

    // 老文案讲的是机制（"点击排序，再点反向，第三次取消"），已经删掉。
    expect(screen.queryByText(/第三次取消/)).toBeNull();
  });
});
