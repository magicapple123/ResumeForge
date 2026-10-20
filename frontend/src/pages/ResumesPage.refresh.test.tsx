/**
 * 简历中心：手写简历保存后列表**自己**刷新（T12）。
 *
 * 旧实现是"关弹窗就 reload"——于是取消也白跑一次请求，而且别的入口（我的资料的通用
 * 简历区块）根本没人为它 reload。现在保存方 `bumpResumeList()` 广播，订阅方各自重取。
 *
 * 这里不真的走一遍弹窗表单（那条链路由 ManualResumeModal 自己的用例铺开），只钉
 * 页面这一侧的契约：收到广播 → 重取；关弹窗但没保存 → 什么都不发生。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeBrief } from "../types";
import { bumpResumeList, resetResumeListEventsForTests } from "../features/resume/resumeListEvents";
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
  createManualResume: vi.fn(),
  getProfile: vi.fn(),
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
  createManualResume: apiMocks.createManualResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

// 手写简历弹窗一打开就读资料；不桩掉会在 jsdom 里真发 fetch。
vi.mock("../api/profile", () => ({ getProfile: apiMocks.getProfile }));

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

const PROFILE = {
  id: 1,
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  target_city: "",
  job_intent: "",
  personal_website: "",
  github: "",
  summary: "",
  wechat: "",
  birth_date: "",
  id_type: "",
  id_number: "",
  country_region: "",
  native_place: "",
  political_status: "",
  phone_country_code: "+86",
  family_info: "",
  expected_salary: "",
  qq: "",
  advisor: "",
  research_direction: "",
  preferred_industry: "",
  section_order: [],
  educations: [],
  experiences: [],
  campus_experiences: [],
  projects: [],
  skills: [],
  awards: [],
};

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
  resetResumeListEventsForTests();
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [RESUME], total: 1 });
  apiMocks.listResumeIds.mockReset().mockResolvedValue([RESUME.id]);
  apiMocks.createManualResume.mockReset().mockResolvedValue({ id: 9 });
  apiMocks.getProfile.mockReset().mockResolvedValue(PROFILE);
  apiMocks.getResume.mockReset().mockResolvedValue({ ...RESUME, content: {} });
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
  apiMocks.batchDeleteResumes.mockReset().mockResolvedValue({ deleted: 1 });
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.fetchResumeHtml.mockReset().mockResolvedValue("<p>预览</p>");
  apiMocks.renderResume.mockReset().mockResolvedValue("<p>预览</p>");
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset().mockResolvedValue({ id: 3, title: "制造工程师" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetResumeListEventsForTests();
});

describe("ResumesPage 列表刷新（T12）", () => {
  it("收到简历列表广播后自动重取（保存方不必知道谁在看列表）", async () => {
    renderPage();
    await screen.findByText(RESUME.title);
    expect(apiMocks.listResumes).toHaveBeenCalledOnce();

    act(() => bumpResumeList());

    await waitFor(() => expect(apiMocks.listResumes).toHaveBeenCalledTimes(2));
  });

  it("打开又关掉手写简历弹窗（没保存）不会白跑一次请求", async () => {
    renderPage();
    await screen.findByText(RESUME.title);
    expect(apiMocks.listResumes).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /新建简历/ }));
    await waitFor(() => expect(apiMocks.getProfile).toHaveBeenCalled());

    // 直接关掉编辑器（未改动 → 不弹未保存确认）。
    fireEvent.click(await screen.findByRole("button", { name: /取\s*消/ }));

    // 关弹窗本身不该产生任何列表请求。
    expect(apiMocks.listResumes).toHaveBeenCalledOnce();
    expect(apiMocks.createManualResume).not.toHaveBeenCalled();
  });
});
