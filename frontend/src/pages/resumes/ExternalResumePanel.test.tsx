// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心「外部简历」区块：空态 / 列表 / 删除撤销 / 用于面试的两种结局。
 *
 * 断言一律走 role 或 `t()`（不用中文 `*ByText`）：测试里的中文断言也计入 i18n 棘轮。
 * 删除是**软删 + Toast 撤销**（不弹二次确认），这里连点撤销一起钉住。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ExternalResumePanel from "./ExternalResumePanel";

const navigateMock = vi.hoisted(() => vi.fn());
const apiMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  uploadExternalResume: vi.fn(),
  deleteExternalResume: vi.fn(),
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
const trashMocks = vi.hoisted(() => ({ restoreTrashItem: vi.fn(), restoreTrashItems: vi.fn() }));
const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../../api/externalResumes", () => apiMocks);
vi.mock("../../api/trash", () => trashMocks);
vi.mock("../../api/jobs", () => jobMocks);
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function externalResume(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function renderPanel(variant: "card" | "bare" = "card") {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ExternalResumePanel variant={variant} />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  apiMocks.listExternalResumes
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  apiMocks.deleteExternalResume.mockReset().mockResolvedValue(undefined);
  apiMocks.uploadExternalResume.mockReset();
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset().mockResolvedValue(null);
  trashMocks.restoreTrashItem.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumePanel", () => {
  it("没有外部简历时给空态，空态里自带上传主按钮", async () => {
    renderPanel();

    expect(await screen.findByText(t("resumesPage.external.empty"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("resumesPage.external.upload") }),
    ).toBeInTheDocument();
  });

  it("列表显示名称、字数、外部标签；未提取到文字的条目另有警示标签", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [
        externalResume(),
        externalResume({ id: 2, name: "scan-file.pdf", has_text: false, text_chars: 0 }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    });
    renderPanel();

    expect(await screen.findByText("external-a.txt")).toBeInTheDocument();
    expect(screen.getByText(t("resumesPage.external.chars", { count: 120 }))).toBeInTheDocument();
    expect(screen.getByText("scan-file.pdf")).toBeInTheDocument();
    expect(screen.getByText(t("resumesPage.external.noText"))).toBeInTheDocument();
    // 只读快照的说明必须在区块上写清（否则用户会点进去找编辑）。
    expect(screen.getByText(t("resumesPage.external.subtitle"))).toBeInTheDocument();
  });

  it("删除直接执行（不弹确认），Toast 里的撤销会调回收站恢复并刷新列表", async () => {
    apiMocks.listExternalResumes
      .mockResolvedValueOnce({ items: [externalResume()], total: 1, page: 1, page_size: 100 })
      .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    renderPanel();

    await screen.findByText("external-a.txt");
    fireEvent.click(screen.getByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("resumesPage.external.delete") }),
    );

    await waitFor(() => expect(apiMocks.deleteExternalResume).toHaveBeenCalledWith(1));
    fireEvent.click(await screen.findByRole("button", { name: t("toast.undo.label") }));

    await waitFor(() =>
      expect(trashMocks.restoreTrashItem).toHaveBeenCalledWith("external_resume", 1),
    );
    // 撤销 + 删除各触发一次刷新（列表至少被重取两次）。
    await waitFor(() => expect(apiMocks.listExternalResumes.mock.calls.length).toBeGreaterThan(1));
  });

  it("「用于面试」跳到带 externalResumeId 的面试图（预填由设定卡负责）", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume()],
      total: 1,
      page: 1,
      page_size: 100,
    });
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: t("resumesPage.external.useForInterview") }),
    );

    expect(navigateMock).toHaveBeenCalledWith("/interview?externalResumeId=1");
  });

  it("没有文字层的简历点「用于面试」不跳转，而是说明可在面试页上传原件", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume({ has_text: false, text_chars: 0 })],
      total: 1,
      page: 1,
      page_size: 100,
    });
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: t("resumesPage.external.useForInterview") }),
    );

    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(t("resumesPage.external.noTextForInterview")),
    ).toBeInTheDocument();
  });
});

describe("ExternalResumePanel · bare 变体（07-1 空白行）", () => {
  const uploadName = () => new RegExp(t("resumesPage.external.upload"));

  it("标题行由面板渲染在卡片之外，上传按钮与标题同一行", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({
      items: [externalResume()],
      total: 1,
      page: 1,
      page_size: 100,
    });
    const { container } = renderPanel("bare");

    await screen.findByText("external-a.txt");
    const header = container.querySelector(".external-resume-header");
    expect(header).not.toBeNull();
    // 标题与按钮同属标题行；卡片头不存在（§1.9），按钮也不再占卡片里的一整行。
    expect(header?.querySelector("h4")?.textContent).toBe(t("resumesPage.external.title"));
    expect(header?.querySelector("button")).not.toBeNull();
    expect(container.querySelectorAll(".ant-card-head")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: uploadName() })).toHaveLength(1);
  });

  it("空列表时标题行不放按钮：只留空态那一颗", async () => {
    const { container } = renderPanel("bare");

    await screen.findByText(t("resumesPage.external.empty"));
    const header = container.querySelector(".external-resume-header");
    expect(header).not.toBeNull();
    expect(header?.querySelector("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: uploadName() })).toHaveLength(1);
  });
});
