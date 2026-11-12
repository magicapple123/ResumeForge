// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心批量导出：点动作先弹「本次参数」卡片（不跳设置页），确认后按这一份参数导出。
 *
 * 单独成文件（而不是并入 ResumesPage.test.tsx）：那个文件已经贴着 500 行预算，而这里的
 * 用例要额外桩掉导出接口、批量参数接口与浏览器下载。
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
  listResumes: vi.fn(),
  listResumeIds: vi.fn(),
}));
const batchExportMocks = vi.hoisted(() => ({ batchExportResumes: vi.fn() }));
const batchSettingsMocks = vi.hoisted(() => ({ getBatchOperationConfig: vi.fn() }));
const downloadMocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  listResumes: apiMocks.listResumes,
  listResumeIds: apiMocks.listResumeIds,
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));
vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));
vi.mock("../api/resumeBatchExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumeBatchExport")>()),
  batchExportResumes: batchExportMocks.batchExportResumes,
}));
vi.mock("../api/settingsBatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/settingsBatch")>()),
  getBatchOperationConfig: batchSettingsMocks.getBatchOperationConfig,
}));
vi.mock("../utils/download", () => downloadMocks);
vi.mock("../features/resume/preview/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
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

const GENERATION = {
  template: "classic",
  format_name: "",
  font_scale: "standard",
  page_limit: 1,
  language: "zh-CN",
  enhance: false,
  enhancement_level: "balanced",
  custom_instruction: "",
};

const EXPORT = {
  template: "scholar",
  format_name: "",
  font_scale: "large",
  page_limit: 2,
  language: "zh-CN",
  export_format: "docx",
};

function sections(exportConfigured: boolean) {
  return {
    generation: { ...GENERATION, configured: false, updated_at: null },
    export: { ...EXPORT, configured: exportConfigured, updated_at: null },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/resumes"]}>
      <AntdApp>
        <ResumesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

async function enterSelectingAndPickOne() {
  const title = await screen.findByText(RESUME.title, {}, { timeout: 5000 });
  fireEvent.contextMenu(title.closest("tr") as HTMLElement);
  fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  fireEvent.click(screen.getAllByRole("checkbox")[1]!);
}

async function openBatchExportModal() {
  fireEvent.click(screen.getByRole("button", { name: "批量操作" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /批量导出/ }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  window.sessionStorage.clear();
  batchSettingsMocks.getBatchOperationConfig.mockReset();
  batchExportMocks.batchExportResumes.mockReset();
  downloadMocks.downloadBlob.mockReset();
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [RESUME], total: 1 });
  apiMocks.listResumeIds.mockReset().mockResolvedValue([RESUME.id]);
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset();
});

afterEach(cleanup);

describe("ResumesPage 批量导出", () => {
  it("点批量导出直接弹「本次参数」，不跳页面、不发请求", async () => {
    batchSettingsMocks.getBatchOperationConfig.mockResolvedValue(sections(false));
    renderPage();

    await enterSelectingAndPickOne();
    const dialog = await openBatchExportModal();

    // 未配置时用默认值开局，并说明"可直接开始"——不能是空白或"去设置"。
    expect(dialog.textContent).toContain(t("batchOperation.modal.defaults"));
    expect(dialog.textContent).toContain(t("batchOperation.modal.count.export", { count: 1 }));
    expect(batchExportMocks.batchExportResumes).not.toHaveBeenCalled();
  });

  it("已配置时弹窗预填全局参数，确认后按弹窗里的那份导出", async () => {
    batchSettingsMocks.getBatchOperationConfig.mockResolvedValue(sections(true));
    batchExportMocks.batchExportResumes.mockResolvedValue({
      blob: new Blob(["zip"]),
      filename: "简历批量导出.zip",
      exported: 1,
      skipped: 0,
      skippedDetail: "",
    });
    renderPage();

    await enterSelectingAndPickOne();
    await openBatchExportModal();
    fireEvent.click(
      await screen.findByRole("button", { name: t("batchOperation.modal.start.export") }),
    );

    await waitFor(() =>
      expect(batchExportMocks.batchExportResumes).toHaveBeenCalledWith(
        [RESUME.id],
        expect.objectContaining({ template: "scholar", page_limit: 2, export_format: "docx" }),
      ),
    );
    expect(
      await screen.findByText(t("batchOperation.export.done", { count: 1 })),
    ).toBeInTheDocument();
    expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1);
  });
});
