// SPDX-License-Identifier: Apache-2.0
/**
 * 简历页：列提示、收藏、通用简历、备注列、行操作、URL 状态化、深链。
 *
 * 「按岗位筛选」（R15）的用例已拆到 `ResumesPage.jobFilter.test.tsx`（行数预算）；
 * 「批量选择 / 跨页全选」的用例已拆到 `ResumesPage.batch.test.tsx`（行数预算）。
 */

import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import {
  cleanupResumesPage,
  renderResumesPage,
  resetResumesPageMocks,
  RESUME,
} from "../test/resumesPageHarness";
import ResumesPage from "./ResumesPage";

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
  fetchResumePreviewHtml: apiMocks.fetchResumePreviewHtml,
  renderResume: apiMocks.renderResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

// 深链用例只关心"详情弹窗开了没有、URL 参数有没有清掉"；预览主体是重渲染路径，
// 由它自己的测试负责，这里桩掉。
vi.mock("../features/resume/preview/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

// 岗位筛选下拉（R15）会远程搜岗位，并按 id 回查已选岗位：两个端点都要桩掉，
// 否则用例会去敲真实后端。
const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));

beforeEach(() => {
  resetResumesPageMocks(apiMocks, jobMocks);
});

afterEach(() => {
  cleanupResumesPage();
});

describe("ResumesPage column hints", () => {
  it("explains what a beauty-enhancement level actually did on hover", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, enhancement_enabled: true, enhancement_level: "balanced" }],
      total: 1,
    });
    renderResumesPage();
    await screen.findByText(RESUME.title);

    // “均衡”两个字本身说明不了什么，悬停要给出这一档做了什么。
    fireEvent.mouseEnter(screen.getByText("均衡"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "补足方法与业务目的：每条要点 28-36 字、每条 2-3 条",
    );
  });

  it("explains what a general resume is on hover", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, job_id: null, job_title: "软件开发" }],
      total: 1,
    });
    renderResumesPage();
    await screen.findByText(RESUME.title);

    fireEvent.mouseEnter(screen.getByText("通用简历"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("不关联岗位、可投递多个方向");
  });
});

describe("ResumesPage favorites", () => {
  it("favorites a resume and blocks duplicate submissions while the update is pending", async () => {
    let resolveUpdate!: () => void;
    apiMocks.updateResumeFavorite.mockImplementation(
      () => new Promise<void>((resolve) => (resolveUpdate = resolve)),
    );
    renderResumesPage();
    await screen.findByText(RESUME.title);
    const favoriteButton = screen.getByRole("button", { name: "收藏简历" });

    fireEvent.click(favoriteButton);
    fireEvent.click(favoriteButton);

    expect(apiMocks.updateResumeFavorite).toHaveBeenCalledWith(RESUME.id, true);
    expect(apiMocks.updateResumeFavorite).toHaveBeenCalledOnce();
    // 悬停提示会在状态变化时重挂子节点，抓在手里的旧引用会变成游离节点——重新查一次。
    expect(screen.getByRole("button", { name: "收藏简历" })).toBeDisabled();
    resolveUpdate();
    await waitFor(() => expect(apiMocks.listResumes).toHaveBeenCalledTimes(2));
  });

  it("uses the same control to remove an existing favorite", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, favorite: true }],
      total: 1,
    });
    renderResumesPage();
    await screen.findByText(RESUME.title);

    fireEvent.click(screen.getByRole("button", { name: "取消收藏简历" }));

    await waitFor(() =>
      expect(apiMocks.updateResumeFavorite).toHaveBeenCalledWith(RESUME.id, false),
    );
  });
});

describe("ResumesPage 通用简历", () => {
  it("marks a job-less record as 通用简历 and shows the intent instead of a job", async () => {
    // 无岗位记录的 job_title 存的是求职意向，以前会被当成岗位名显示，
    // 于是通用简历看起来和岗位简历一模一样。
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, job_id: null, job_title: "后端开发", company: "" }],
      total: 1,
    });
    renderResumesPage();

    const row = (await screen.findByText(RESUME.title)).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("通用简历")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("求职意向：后端开发")).toBeInTheDocument();
    // 有岗位时岗位名是一个可点击跳转的按钮；通用简历不该有
    expect(within(row as HTMLElement).queryByRole("button", { name: RESUME.job_title })).toBeNull();
  });

  it("keeps job-linked records linking to their job", async () => {
    renderResumesPage();

    const row = (await screen.findByText(RESUME.title)).closest("tr");
    expect(within(row as HTMLElement).getByText(RESUME.job_title)).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("通用简历")).toBeNull();
  });
});

describe("ResumesPage 备注列", () => {
  it("把简历备注直接展示在列表里（B5）", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, note: "重点跟进，本周五前回复" }],
      total: 1,
    });
    renderResumesPage();
    await screen.findByText(RESUME.title);

    expect(screen.getByText("重点跟进，本周五前回复")).toBeInTheDocument();
  });
});

describe("ResumesPage 行操作（三点菜单与右键菜单一致）", () => {
  it("行内有三点「更多操作」按钮；右键菜单仍含全部次级操作", async () => {
    renderResumesPage();
    const title = await screen.findByText(RESUME.title);

    expect(await screen.findByRole("button", { name: "更多操作" })).toBeInTheDocument();
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);
    expect(await screen.findByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "编辑备注" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "版本对比" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("键盘可达：聚焦行内元素时按 ContextMenu 键打开同一份右键菜单", async () => {
    renderResumesPage();
    const title = await screen.findByText(RESUME.title);

    fireEvent.keyDown(title.closest("tr") as HTMLElement, { key: "ContextMenu", bubbles: true });
    expect(await screen.findByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
  });

  it("删除确认按钮写具体动作：确认「删除这份简历」、取消「先不删」", async () => {
    renderResumesPage();
    const title = await screen.findByText(RESUME.title);
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));

    const confirmRoot = await waitFor(
      () => {
        const root = document.querySelector(".ant-modal-confirm");
        expect(root).not.toBeNull();
        return root as HTMLElement;
      },
      { timeout: 5000 },
    );
    // 存量缺陷（QA R.07）：按钮是默认「取 消 / 确 定」。改为具体动作后，点确认也确实删除。
    const okButton = within(confirmRoot).getByRole("button", {
      name: t("resumes.remove.confirm.ok"),
    });
    expect(
      within(confirmRoot).getByRole("button", { name: t("resumes.remove.confirm.cancel") }),
    ).toBeInTheDocument();
    expect(apiMocks.deleteResume).not.toHaveBeenCalled();

    fireEvent.click(okButton);
    await waitFor(() => expect(apiMocks.deleteResume).toHaveBeenCalledWith(RESUME.id));
  });
});

describe("ResumesPage URL 状态化", () => {
  it("从 URL 恢复关键词筛选（收藏状态筛选已移除，走收藏夹）", async () => {
    renderResumesPage(["/resumes?keyword=%E5%88%B6%E9%80%A0"]);

    await waitFor(() => {
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: "制造" }),
      );
    });
    const searchInput = screen.getByPlaceholderText("搜索简历记录") as HTMLInputElement;
    expect(searchInput.value).toBe("制造");
    // 收藏状态筛选入口已下线：页面上不再有它的 Select。
    expect(screen.queryByText("收藏状态")).not.toBeInTheDocument();
  });
});

describe("ResumesPage ?resume_id= 深链（RF-11）", () => {
  function LocationProbe() {
    const location = useLocation();
    return <span data-testid="location">{location.pathname + location.search}</span>;
  }

  function renderPageWithProbe(initialEntries: string[]) {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <AntdApp>
          <ResumesPage />
          <LocationProbe />
        </AntdApp>
      </MemoryRouter>,
    );
  }

  it("深链自动打开详情弹窗并按 id 取详情", async () => {
    renderResumesPage(["/resumes?resume_id=8"]);

    expect(await screen.findByTestId("resume-preview-stub")).toBeInTheDocument();
    expect(apiMocks.getResume).toHaveBeenCalledWith(8);
    // 详情预览要完整正文（超额页也要画出来，问题清单 §7），所以显式带 includeOverflowPages。
    expect(apiMocks.fetchResumePreviewHtml).toHaveBeenCalledWith(8, {
      includeOverflowPages: true,
    });
  });

  it("非法 resume_id 忽略：不打开弹窗、不取详情", async () => {
    renderResumesPage(["/resumes?resume_id=abc"]);

    await screen.findByText(RESUME.title);
    expect(screen.queryByTestId("resume-preview-stub")).toBeNull();
    expect(apiMocks.getResume).not.toHaveBeenCalled();
  });

  it("关闭弹窗时从 URL 移除 resume_id 参数（replace，不打历史）", async () => {
    renderPageWithProbe(["/resumes?resume_id=8"]);
    await screen.findByTestId("resume-preview-stub");

    // 2026-10-24 起弹窗自绘右上角的 ×（`closable={false}`）：可访问名走
    // `common.action.close`，与全站「关闭」同一个词。
    fireEvent.click(screen.getByRole("button", { name: t("common.action.close") }));

    // 只断 URL：jsdom 里 antd 的离场动画等不到 transitionend，弹窗内容不会真正
    // 卸载（onClose 已同步触发），断 DOM 移除会假红。
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).not.toContain("resume_id"),
    );
    expect(screen.getByTestId("location").textContent).toBe("/resumes");
  });
});
