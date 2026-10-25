// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「通用 AI 入口」与场景建议卡（A2，从 ResumesPage.test.tsx 拆出）。
 *
 * 守三条：入口可达（打开同一个生成弹窗 job=null）、打开不改变列表筛选、建议卡只提供
 * 入口且不按场景过滤任何已有简历。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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

// 深链/详情主体是重渲染路径，由它自己的测试负责，这里桩掉。
vi.mock("../components/resume/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

// 通用 AI 入口打开的生成弹窗会读模型配置、场景目录与模板目录：全部桩掉，
// 让"入口可达"这条断言不依赖真实后端。
const runtimeMocks = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  listResumeFonts: vi.fn(),
  listCareerScenarios: vi.fn(),
  fetchCareerScenarioCatalog: vi.fn(),
}));

vi.mock("../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/settings")>()),
  getLLMConfig: runtimeMocks.getLLMConfig,
  listResumeFonts: runtimeMocks.listResumeFonts,
}));
vi.mock("../features/career-scenarios/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/career-scenarios/api")>()),
  listCareerScenarios: runtimeMocks.listCareerScenarios,
  fetchCareerScenarioCatalog: runtimeMocks.fetchCareerScenarioCatalog,
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
  updated_at: "2026-08-21T09:30:00",
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
  runtimeMocks.getLLMConfig
    .mockReset()
    .mockResolvedValue({ base_url: "https://api.example.com/v1", model: "m" });
  runtimeMocks.listResumeFonts
    .mockReset()
    .mockResolvedValue({ items: [], active: null, max_bytes: 1 });
  runtimeMocks.listCareerScenarios.mockReset().mockResolvedValue({ items: [], total: 0 });
  runtimeMocks.fetchCareerScenarioCatalog.mockReset().mockResolvedValue({
    catalog_version: "1",
    schema_version: 1,
    limits: {
      max_name_chars: 40,
      max_scenarios: 50,
      max_config_bytes: 16384,
      max_expression_preferences: 800,
    },
    presets: [],
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage 通用 AI 入口（A2）", () => {
  it("「AI 生成」打开通用简历生成弹窗（job=null），不改动列表筛选", async () => {
    renderPage();
    await screen.findByText(RESUME.title);
    const listCallsBefore = apiMocks.listResumes.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: t("careerScenarios.center.aiGenerateAria") }),
    );

    const dialog = await screen.findByRole("dialog");
    // 弹窗标题由组件写死（生成通用简历）；用 DOM 读而不是 ByText，避免给 CJK 断言加存量。
    expect(dialog.querySelector(".ant-modal-title")?.textContent).toContain("生成通用简历");
    expect(await screen.findByLabelText("简历名称")).toBeInTheDocument();
    // 打开弹窗不重取列表、也不改筛选：调用次数与打开前一致。
    expect(apiMocks.listResumes.mock.calls.length).toBe(listCallsBefore);
  });

  it("场景建议卡只提供入口，不按场景过滤已有简历", async () => {
    renderPage();
    await screen.findByText(RESUME.title);

    expect(screen.getByText(t("careerScenarios.center.suggestionTitle"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("careerScenarios.center.suggestionGenerate") }),
    );
    expect(
      (await screen.findByRole("dialog")).querySelector(".ant-modal-title")?.textContent,
    ).toContain("生成通用简历");

    const listCalls = apiMocks.listResumes.mock.calls;
    const lastCall = listCalls[listCalls.length - 1]?.[0] as Record<string, unknown>;
    expect(lastCall).toEqual(
      expect.objectContaining({ keyword: "", has_job: undefined, job_id: undefined }),
    );
    expect(lastCall).not.toHaveProperty("scenario");
  });

  it("建议卡的「去选目标岗位」跳到岗位广场（不调用模型）", async () => {
    function LocationProbe() {
      const location = useLocation();
      return <span data-testid="location">{location.pathname}</span>;
    }
    render(
      <MemoryRouter initialEntries={["/resumes"]}>
        <AntdApp>
          <ResumesPage />
          <LocationProbe />
        </AntdApp>
      </MemoryRouter>,
    );
    await screen.findByText(RESUME.title);

    fireEvent.click(
      screen.getByRole("button", { name: t("careerScenarios.center.suggestionJobs") }),
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/jobs"));
  });
});
