// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历独立页（第 1 条）。
 *
 * 关键断言是**结构**而不是文案：页面标题不进 `Card title`，所以整页 `.ant-card-head`
 * 数量必须为 0（清单 §1.9 的硬约束）。返回按钮在没有历史时降级到 `/resumes`
 * （MemoryRouter 不写 window.history，等价于"直接打开"）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

/**
 * 上传按钮的可访问名：带图标的按钮名里含 `aria-label="upload"`，精确匹配拿不到，
 * 所以用正则按子串匹配（空态那颗与标题行那颗同一个文案）。
 */
function uploadName(): RegExp {
  return new RegExp(t("resumesPage.external.upload"));
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

  it("空列表只留空态那一颗上传按钮（标题行不再重复一颗）", async () => {
    renderPage();

    await screen.findByText(t("resumesPage.external.empty"));
    expect(screen.getAllByRole("button", { name: uploadName() })).toHaveLength(1);
  });

  it("列表非空时上传按钮在标题行右端，与标题同一行且只有一颗（07-1）", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [
        {
          id: 1,
          file_id: 11,
          name: "external-a.txt",
          mime: "text/plain",
          text_chars: 120,
          has_text: true,
          job_id: null,
          job_title: "",
          created_at: "2026-11-10T10:00:00",
          updated_at: "2026-11-10T10:00:00",
          warnings: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    const { container } = renderPage();

    await screen.findByText("external-a.txt");
    // 标题行是同一块容器：标题与按钮都在里面，按钮不再是卡片里单独的一行。
    const header = container.querySelector(".external-resume-header");
    expect(header).not.toBeNull();
    const scoped = within(header as HTMLElement);
    expect(
      scoped.getByRole("heading", { name: t("resumesPage.external.title") }),
    ).toBeInTheDocument();
    expect(scoped.getByRole("button", { name: uploadName() })).toBeInTheDocument();
    // 整页只有这一颗（卡片里没有第二颗）。
    expect(screen.getAllByRole("button", { name: uploadName() })).toHaveLength(1);
    // 副标题仍在标题行里（页面级），不在 `.ant-card-head` 中。
    expect(scoped.getByText(t("resumesPage.external.subtitle"))).toBeInTheDocument();
    expect(container.querySelectorAll(".ant-card-head")).toHaveLength(0);
  });
});
