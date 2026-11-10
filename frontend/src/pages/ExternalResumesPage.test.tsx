// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历独立页（第 1 条）。
 *
 * 关键断言是**结构**而不是文案：页面标题不进 `Card title`，所以整页 `.ant-card-head`
 * 数量必须为 0（清单 §1.9 的硬约束）。返回按钮在没有历史时降级到 `/resumes`
 * （MemoryRouter 不写 window.history，等价于"直接打开"）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ExternalResumesPage from "./ExternalResumesPage";

const apiMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  uploadExternalResume: vi.fn(),
  deleteExternalResume: vi.fn(),
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/externalResumes", () => apiMocks);
vi.mock("../api/jobs", () => jobMocks);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/resumes/external"]}>
      <AntdApp>
        <Routes>
          <Route path="/resumes/external" element={<ExternalResumesPage />} />
          <Route path="/resumes" element={<div data-testid="resumes-stub" />} />
        </Routes>
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMocks.listExternalResumes
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumesPage", () => {
  it("标题由页面自己渲染：整页没有卡片头（`.ant-card-head` 数量为 0）", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: t("resumesPage.external.title") }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".ant-card-head")).toHaveLength(0);
    // 页面根节点不包 Card：列表卡是唯一的 .ant-card，且它不在 .app-content 的直接子级。
    expect(
      screen.getByRole("button", { name: t("resumesPage.external.back") }),
    ).toBeInTheDocument();
  });

  it("点「返回简历中心」回到 /resumes（没有历史时降级，不退出应用）", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: t("resumesPage.external.back") }));
    expect(await screen.findByTestId("resumes-stub")).toBeInTheDocument();
  });
});
