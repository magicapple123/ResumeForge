/** 简历预览弹窗的关联上下文行（RF-11）：有 job_id 给三段直达链接，通用简历没有。 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDetail } from "../types";
import ResumeDetailModal from "./ResumeDetailModal";

const apiMocks = vi.hoisted(() => ({
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  fetchResumeTemplates: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  updateResumeLayout: vi.fn(),
  listResumeDeliveries: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
// 预览主体是另一批测试的对象；这里只关心弹窗自己的上下文行，桩掉即可。
vi.mock("./resume/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

function makeDetail(overrides: Partial<ResumeDetail>): ResumeDetail {
  return {
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
    content: {
      photo: "",
      name: "",
      gender: "",
      birth_year: "",
      phone: "",
      email: "",
      city: "",
      personal_website: "",
      github: "",
      job_intent: "",
      summary: "",
      education: [],
      experience: [],
      campus_experience: [],
      projects: [],
      skills: [],
      awards: [],
    },
    warnings: [],
    parse_error: "",
    parent_revision_id: null,
    rationale: "",
    coverage_notes: [],
    ...overrides,
  };
}

function renderModal(recordId: number | null) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailModal recordId={recordId} onClose={vi.fn()} />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue({ pdf_direct_available: true });
  apiMocks.listResumeDeliveries.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeDetailModal 关联上下文行（RF-11）", () => {
  it("有 job_id：三段直达链接都带着该岗位的 id", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByTestId("resume-preview-stub")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "查看关联岗位" })).toHaveAttribute(
      "href",
      "/jobs?job_id=3",
    );
    expect(screen.getByRole("link", { name: "该岗位的投递进度" })).toHaveAttribute(
      "href",
      "/tracker?job_id=3",
    );
    expect(screen.getByRole("link", { name: "模拟面试" })).toHaveAttribute(
      "href",
      "/interview?job_id=3",
    );
  });

  it("通用简历（无 job_id）：不渲染上下文行", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({ job_id: null }));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByTestId("resume-preview-stub")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "查看关联岗位" })).toBeNull();
    expect(screen.queryByRole("link", { name: "该岗位的投递进度" })).toBeNull();
    expect(screen.queryByRole("link", { name: "模拟面试" })).toBeNull();
  });
});

/** 版本信息位（RF-17）：血缘与投递记录的诚实口径。 */
describe("ResumeDetailModal 版本信息位（RF-17）", () => {
  it("无血缘无投递：显示「独立版本」，不臆造历史", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByTestId("resume-delivery-info")).toBeInTheDocument());
    expect(screen.getByText("独立版本，暂无投递记录")).toBeInTheDocument();
  });

  it("有血缘：以 id 如实表述派生关系，不猜父简历标题", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({ parent_revision_id: 5 }));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByText("派生自简历 #5")).toBeInTheDocument());
  });

  it("有投递记录：逐条显示「已投递给谁 · 来源 · 时间 · 指纹前 8 位」", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");
    apiMocks.listResumeDeliveries.mockResolvedValue([
      {
        id: 1,
        created_at: "2026-10-11T08:00:00",
        source: "apply",
        job_title: "后端开发实习生",
        company: "示例科技",
        resume_title: "后端岗位简历",
        export_format: "",
        filename: "",
        pages: null,
        content_sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        rendered_config_sha256: "f".repeat(64),
      },
    ]);

    renderModal(8);

    await waitFor(() =>
      // PR-09 文案契约：apply 是唯一显示「已投递给」的来源（三态语义区分）。
      expect(screen.getByText(/已投递给\s*示例科技 · 后端开发实习生 · 投递台/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
    expect(listResumeDeliveriesCalledWith(8)).toBe(true);
  });
});

function listResumeDeliveriesCalledWith(id: number): boolean {
  return apiMocks.listResumeDeliveries.mock.calls.some((call) => call[0] === id);
}
