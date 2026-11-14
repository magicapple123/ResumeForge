// SPDX-License-Identifier: Apache-2.0
/**
 * 简历页的「批量选择 / 跨页全选」（C3）：行右键进入多选、批量删除确认、跨页全选与上限。
 *
 * 从 `ResumesPage.test.tsx` 拆出（行数预算）：这里只放「多选态 → 批量动作」这一域，
 * 其余页面行为仍在主文件里。`vi.mock` 不跨文件 hoist，所以 mock 声明必须在本文件内逐字
 * 声明（先例：ResumesPage.jobFilter.test.tsx）；harness 只共享 RESUME 夹具、渲染入口与
 * mock 复位。
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

// 批量流程不打开详情弹窗；预览主体是独立的重渲染路径，这里仍桩掉，与主文件同一套装配。
vi.mock("../features/resume/preview/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

// 岗位筛选下拉会远程搜岗位，并按 id 回查已选岗位：两个端点都要桩掉，
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

describe("ResumesPage 批量选择", () => {
  /** 在第一条数据行上右键，从菜单里点「批量选择」（入口已从工具栏收进右键菜单）。 */
  async function enterSelectingViaContextMenu() {
    const title = await screen.findByText(RESUME.title, {}, { timeout: 5000 });
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  }

  it("行右键菜单进入多选 → 勾 2 项 → 批量删除 → 确认 → 一次批量删除请求带全部 id（P2-2）", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [RESUME, { ...RESUME, id: 9, title: "另一份简历" }],
      total: 2,
    });
    renderResumesPage();

    // CI 慢机上数据晚于表格就绪——先等第一条数据渲染出来再右键进入多选（5s 安全网）。
    await enterSelectingViaContextMenu();
    // 勾选走 rowSelection 自带的表头/行勾选框（2026-10-16 起 BatchActionBar 的重复
    // 「全选本页」已按用户要求移除，表格表头那个是唯一入口）。rowSelection 的表头
    // 全选框与数据行勾选框都叫「全选本页」/ 行标题，全部现查现点（重渲会重建 DOM）。
    const rowBoxes = () => screen.getAllByRole("checkbox");
    fireEvent.click(rowBoxes()[1]!);
    fireEvent.click(rowBoxes()[2]!);
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "批量操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量删除/ }));
    // 标题只写动作 + 对象；条数按 §4.4 的例外进正文（见下一条断言）。
    expect(
      (await screen.findAllByText("删除选中的简历？", {}, { timeout: 5000 })).length,
    ).toBeGreaterThan(0);
    // 未确认前绝不能删（单删与批量删都不能调）。
    expect(apiMocks.deleteResume).not.toHaveBeenCalled();
    expect(apiMocks.batchDeleteResumes).not.toHaveBeenCalled();
    // 确认弹窗里 antd 会把标题渲染两份（.ant-modal-title 与 .ant-modal-confirm-title），
    // 用文本查询会撞"Found multiple"——直接等容器出现，再在容器内点确认键
    // （okText「删除」被 antd 插空格成「删 除」；容器限定避免与操作条「批量删除」撞名）。
    const confirmRoot = await waitFor(
      () => {
        const root = document.querySelector(".ant-modal-confirm");
        expect(root).not.toBeNull();
        return root as HTMLElement;
      },
      { timeout: 5000 },
    );
    expect(confirmRoot.textContent).toContain("删除选中的简历");
    expect(confirmRoot.textContent).toContain("这 2 份简历");
    fireEvent.click(within(confirmRoot).getByRole("button", { name: /删\s*除/ }));

    // P2-2：批量删除改为一次 POST /resumes/batch-delete，不再前端逐条 N 连发。
    await waitFor(() => expect(apiMocks.batchDeleteResumes).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(apiMocks.batchDeleteResumes).toHaveBeenCalledWith(
      expect.arrayContaining([RESUME.id, 9]),
    );
    expect(await screen.findByText(/已删除 2 份简历/, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("空选时「批量操作」不可用；退出选择清空选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    renderResumesPage();

    // 必须先等数据加载完成：右键菜单要挂在数据行上，行没渲染出来右键是空操作。
    // 顺带钉住 R8 口径：工具栏不再有直接的「批量选择」按钮。
    expect(screen.queryByRole("button", { name: /批量选择/ })).not.toBeInTheDocument();
    await enterSelectingViaContextMenu();
    const actionsBtn = await screen.findByRole("button", { name: "批量操作" }, { timeout: 5000 });
    expect(actionsBtn).toBeDisabled();

    const rowCheckbox = screen.getAllByRole("checkbox")[1]!;
    fireEvent.click(rowCheckbox);
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出选择" }));
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    expect(apiMocks.deleteResume).not.toHaveBeenCalled();
    expect(apiMocks.batchDeleteResumes).not.toHaveBeenCalled();
  });
});

describe("ResumesPage 跨页全选（C3）", () => {
  /** 在第一条数据行上右键进入多选（同上方批量选择用例的入口）。 */
  async function enterSelectingViaContextMenu() {
    const title = await screen.findByText(RESUME.title, {}, { timeout: 5000 });
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  }

  it("「全选全部简历（共 N 个）」拉回全部 id 并计入选区；批量删除收到所有页的 id", async () => {
    // 页面上只有 1 条，但筛选下共有 3 份（跨页不止当前页）。
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    apiMocks.listResumeIds.mockResolvedValue([RESUME.id, 9, 77]);
    renderResumesPage();

    await enterSelectingViaContextMenu();
    // 按钮上的 N 取列表端点的 total，而不是当前页条数。
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    expect(await screen.findByText(/已选中当前筛选下的全部 3 份简历/)).toBeInTheDocument();
    expect(screen.getByText("已选 3 项")).toBeInTheDocument();
    expect(apiMocks.listResumeIds).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "", has_job: undefined }),
    );

    fireEvent.click(screen.getByRole("button", { name: "批量操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量删除/ }));
    const confirmRoot = await waitFor(() => {
      const root = document.querySelector(".ant-modal-confirm");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(confirmRoot.textContent).toContain("删除选中的简历");
    expect(confirmRoot.textContent).toContain("这 3 份简历");
    fireEvent.click(within(confirmRoot).getByRole("button", { name: /删\s*除/ }));

    // 断言批量删除收到**全部页**的 id，而不是只有当前页的那一条。
    await waitFor(() => expect(apiMocks.batchDeleteResumes).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(apiMocks.batchDeleteResumes).toHaveBeenCalledWith([RESUME.id, 9, 77]);
  });

  it("筛选下超过 5000 份时如实拒绝并提示缩小范围，不进入选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    apiMocks.listResumeIds.mockResolvedValue(Array.from({ length: 5001 }, (_, i) => i + 1));
    renderResumesPage();

    await enterSelectingViaContextMenu();
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    // 文案对齐岗位广场：说明总数、上限（与后端批量端点一致的 5000）与出路（先筛选缩小范围）。
    expect(
      await screen.findByText(/共 5001 份简历，超出单次批量上限 5000 份；请先用筛选或搜索缩小范围/),
    ).toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    expect(apiMocks.batchDeleteResumes).not.toHaveBeenCalled();
  });

  it("当前筛选下没有简历时提示为空，不改动选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    apiMocks.listResumeIds.mockResolvedValue([]);
    renderResumesPage();

    await enterSelectingViaContextMenu();
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    expect(await screen.findByText("当前筛选下没有简历")).toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
  });
});
