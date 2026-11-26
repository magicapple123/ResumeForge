// SPDX-License-Identifier: Apache-2.0
/**
 * 简历页分页越界（R5 / T04）：删掉末页最后一条之后不能停在空表上，URL 里的非法
 * `page` / `page_size` 也不能原样喂给分页器。
 *
 * 为什么单独成文件：`ResumesPage.test.tsx` 与几个按域拆出的文件都已接近 500 行预算，
 * 而"页码夹取"需要自己的数据夹具（40/21 条分页数据）与一条完整的删除时序。
 *
 * 断言全部落在**屏幕上看得见的东西**（分页高亮数字、表格里有没有某条记录），而不是
 * `page` 这个内部状态：用户能观察到的就是"高亮在哪一页、页上有没有数据"。
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import {
  cleanupResumesPage,
  renderResumesPage,
  resetResumesPageMocks,
  RESUME,
} from "../test/resumesPageHarness";

const apiMocks = vi.hoisted(() => ({
  deleteResume: vi.fn(),
  batchDeleteResumes: vi.fn(),
  listResumes: vi.fn(),
  listResumeIds: vi.fn(),
  updateResumeFavorite: vi.fn(),
  getResume: vi.fn(),
  fetchResumePreviewHtml: vi.fn(),
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
  fetchResumePreviewHtml: apiMocks.fetchResumePreviewHtml,
  renderResume: apiMocks.renderResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

vi.mock("../features/resume/preview/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));

/** 分页高亮的那一页（antd 只在内部夹取显示值，所以这里读的就是用户看到的东西）。 */
function activePage(): string | null | undefined {
  return document.querySelector(".ant-pagination-item-active")?.textContent;
}

function resumeTitle(index: number): string {
  return `第 ${index} 份分页简历`;
}

/** 造 N 条**通用简历**（`job_id: null`）→ 各自成组、不折叠，走平铺表格按条分页。 */
function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...RESUME,
    id: index + 1,
    title: resumeTitle(index + 1),
    job_id: null,
    job_title: "",
  }));
}

beforeEach(() => {
  resetResumesPageMocks(apiMocks, jobMocks);
});

afterEach(() => {
  cleanupResumesPage();
});

describe("ResumesPage 分页越界（R5 / T04）", () => {
  it("删掉末页唯一一条 → 自动落到新的末页并显示数据（不是空表）", async () => {
    const items = makeItems(21);
    // 第一次取 21 条（3 页，末页 1 条）；删除后重取 20 条（2 页）。
    apiMocks.listResumes.mockResolvedValueOnce({ items, total: items.length });
    apiMocks.listResumes.mockResolvedValue({ items: items.slice(0, 20), total: 20 });

    renderResumesPage(["/resumes?page=3"]);
    await screen.findByText(resumeTitle(21));
    await waitFor(() => expect(activePage()).toBe("3"), { timeout: 3000 });

    // 行右键 → 「删除」→ 二次确认（入口与文案由 RowActions 统一提供）。
    fireEvent.contextMenu(screen.getByText(resumeTitle(21)).closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^删\s*除$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /删\s*除这份简历/ }));

    // 关键断言：页码自己回到新的末页（2），而且那一页上真的有数据。
    await waitFor(() => expect(activePage()).toBe("2"), { timeout: 5000 });
    expect(await screen.findByText(resumeTitle(20))).toBeInTheDocument();
    // 末页那一条已经不在列表里了。
    expect(screen.queryByText(resumeTitle(21))).toBeNull();
  });

  it("夹取之后点分页数字仍有响应（不再出现点了没反应）", async () => {
    const items = makeItems(21);
    apiMocks.listResumes.mockResolvedValueOnce({ items, total: items.length });
    apiMocks.listResumes.mockResolvedValue({ items: items.slice(0, 20), total: 20 });

    renderResumesPage(["/resumes?page=3"]);
    await screen.findByText(resumeTitle(21));

    fireEvent.contextMenu(screen.getByText(resumeTitle(21)).closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^删\s*除$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /删\s*除这份简历/ }));
    await waitFor(() => expect(activePage()).toBe("2"), { timeout: 5000 });

    // 从第 2 页点回第 1 页：antd 的 onChange 必须真的被触发。
    fireEvent.click(document.querySelector(".ant-pagination-item-1") as HTMLElement);
    await waitFor(() => expect(activePage()).toBe("1"), { timeout: 3000 });
    expect(await screen.findByText(resumeTitle(1))).toBeInTheDocument();
  });

  it("URL 里的 page 超出现有页数时落到最后一页，而不是停在空表", async () => {
    const items = makeItems(21);
    apiMocks.listResumes.mockResolvedValue({ items, total: items.length });

    renderResumesPage(["/resumes?page=99"]);

    await waitFor(() => expect(activePage()).toBe("3"), { timeout: 5000 });
    expect(await screen.findByText(resumeTitle(21))).toBeInTheDocument();
  });

  it("URL 里非法的 page_size（-5）回落到默认 10，不把负数喂给分页器", async () => {
    const items = makeItems(12);
    apiMocks.listResumes.mockResolvedValue({ items, total: items.length });

    renderResumesPage(["/resumes?page_size=-5"]);

    // pageSize=10 时第 1 页是 1..10；未校验时切片是 slice(0, -5)，会显示 1..7 且没有
    // 第 2 页——所以"第 10 条在、第 11 条不在、存在第 2 页"三件事足以钉住校验。
    expect(await screen.findByText(resumeTitle(10))).toBeInTheDocument();
    expect(screen.queryByText(resumeTitle(11))).toBeNull();
    expect(document.querySelector(".ant-pagination-item-2")).not.toBeNull();
  });
});
