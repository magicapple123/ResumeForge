// SPDX-License-Identifier: Apache-2.0
/**
 * ResumesPage 测试共用的 RESUME 夹具、渲染入口与 mock 复位逻辑。
 *
 * 2026-11（行数预算）：ResumesPage.test.tsx 逼近 500 行测试预算，按域拆出
 * 「批量选择 / 跨页全选」到 ResumesPage.batch.test.tsx。vi.mock 声明必须留在各测试
 * 文件内（vitest 的 mock 注册是文件级的、按测试文件装配），但夹具与 render /
 * beforeEach 复位逻辑只有一份实现——就是本文件（先例：assistantPageHarness.tsx、
 * profilePageHarness.tsx）。
 *
 * 本文件不是 `.test.` 文件：vitest 不收集，也不进 i18n 棘轮与产品文案扫描口径。
 */
import { App as AntdApp } from "antd";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Mock } from "vitest";
import type { ResumeBrief } from "../types";
import ResumesPage from "../pages/ResumesPage";

/** 各测试文件用 `vi.hoisted` 自建的 api mock 形状。 */
export interface ResumesApiMocks {
  deleteResume: Mock;
  batchDeleteResumes: Mock;
  listResumes: Mock;
  listResumeIds: Mock;
  updateResumeFavorite: Mock;
  getResume: Mock;
  fetchResumePreviewHtml: Mock;
  renderResume: Mock;
}

/** 岗位下拉的远程搜索 mock 形状。 */
export interface ResumesJobMocks {
  listJobs: Mock;
  getJob: Mock;
}

export const RESUME: ResumeBrief = {
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

export function renderResumesPage(initialEntries: string[] = ["/resumes"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <ResumesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 每条用例前的 mock 复位 + 默认返回值。
 *
 * apiMocks / jobMocks 由各测试文件用 `vi.hoisted` 自建（vi.mock 工厂只能引用同文件的
 * hoisted 值），这里接收进来统一复位。
 */
export function resetResumesPageMocks(apiMocks: ResumesApiMocks, jobMocks: ResumesJobMocks): void {
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
  apiMocks.fetchResumePreviewHtml.mockReset().mockResolvedValue("<p>预览</p>");
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
}

/** 每条用例后的清理：卸载 + 清 DOM。 */
export function cleanupResumesPage(): void {
  cleanup();
  document.body.innerHTML = "";
}
