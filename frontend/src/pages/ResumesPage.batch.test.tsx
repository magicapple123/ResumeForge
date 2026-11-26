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
import { t } from "../i18n";
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

/**
 * 已勾上的**数据行**份数。
 *
 * 表头「全选本页」也是 checkbox，永远是 `[0]`，它不该被点、也不算一份（它在全部行
 * 都勾上时会自己变选中态，那是"结果"而不是"用户又勾了一份"）。
 */
function checkedRowCount(): number {
  return (screen.getAllByRole("checkbox") as HTMLInputElement[]).filter(
    (box, index) => index > 0 && box.checked,
  ).length;
}

/**
 * 补勾到 `target` 份。
 *
 * 从 R4 起**不能**假设"进入多选时一份都没勾"：右键某一行点「批量选择」会顺手勾上
 * 那一行（三态整组方案里组行代表整组）。所以一律"先读现有份数，再补勾没勾上的行"；
 * 盲目点第 1 个行勾选框是把已经勾上的那行**取消**，计数会掉、按钮会变灰。
 */
function topUpSelection(target: number): void {
  while (checkedRowCount() < target) {
    const next = (screen.getAllByRole("checkbox") as HTMLInputElement[]).find(
      (box, index) => index > 0 && !box.checked,
    );
    if (!next) throw new Error(`only ${checkedRowCount()} rows on this page, need ${target}`);
    fireEvent.click(next);
  }
  expect(checkedRowCount()).toBe(target);
}

describe("ResumesPage 批量选择", () => {
  /** 在第一条数据行上右键，从菜单里点「批量选择」（入口已从工具栏收进右键菜单）。 */
  async function enterSelectingViaContextMenu() {
    const title = await screen.findByText(RESUME.title, {}, { timeout: 5000 });
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  }

  it("行右键菜单进入多选 → 勾 2 项 → 批量删除 → 确认 → 一次批量删除请求带全部 id（P2-2）", async () => {
    apiMocks.listResumes.mockResolvedValue({
      // 两份**不同岗位**的简历（其中一份是通用简历）：折叠视图只在同岗位多版本时出现，
      // 这样本用例仍在平铺表格里验证行勾选与批量删除。
      items: [RESUME, { ...RESUME, id: 9, title: "另一份简历", job_id: null, job_title: "" }],
      total: 2,
    });
    renderResumesPage();

    // CI 慢机上数据晚于表格就绪——先等第一条数据渲染出来再右键进入多选（5s 安全网）。
    await enterSelectingViaContextMenu();
    // 勾选走 rowSelection 自带的表头/行勾选框（2026-10-16 起 BatchActionBar 的重复
    // 「全选本页」已按用户要求移除，表格表头那个是唯一入口）。rowSelection 的表头
    // 全选框与数据行勾选框都叫「全选本页」/ 行标题，全部现查现点（重渲会重建 DOM）。
    topUpSelection(2);
    // 量词是「份」（R1 决策「批量栏按 N 份简历计数」），不是「项」。
    expect(
      screen.getByText(t("resumesPage.batch.selected", { count: 2 })),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("resumesPage.batch.actions") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量删除/ }));
    // 标题只写动作 + 对象；条数按 §4.4 的例外进正文（见下一条断言）。
    expect(
      (await screen.findAllByText(t("resumesPage.batchDelete.title"), {}, { timeout: 5000 })).length,
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
    expect(
      await screen.findByText(t("resumesPage.batchDelete.done", { count: 2 }), {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("批量删除里混着已在回收站的 id：其余照删，toast 说清跳过几条（T06）", async () => {
    // 两份不同岗位的简历 → 平铺视图（同第一条用例的夹具）。
    apiMocks.listResumes.mockResolvedValue({
      items: [RESUME, { ...RESUME, id: 9, title: "另一份简历", job_id: null, job_title: "" }],
      total: 2,
    });
    // 后端跳过了 1 条"已在别处删掉"的 id：只删了 1 份，剩下 1 份被跳过。
    apiMocks.batchDeleteResumes.mockResolvedValue({ deleted: 1, skipped: 1 });
    renderResumesPage();

    await enterSelectingViaContextMenu();
    // 勾满 2 份再删。不能假设"进入多选时一份都没勾"：R4 的三态方案里，右键进入多选会
    // 顺手勾上被右键的那一行（组行代表整组），所以这里读现有勾选数、由少到多补勾。
    // 表头「全选本页」也是 checkbox，永远是 [0] 且不该被点。
    const rowBoxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];
    // 只数**数据行**的勾选框：表头「全选本页」在全部行都被勾上时会自己变成选中态，
    // 那是"结果"而不是"用户又勾了一份"。
    const checkedCount = () => rowBoxes().filter((box, index) => index > 0 && box.checked).length;
    for (let index = 1; index < rowBoxes().length && checkedCount() < 2; index += 1) {
      if (!rowBoxes()[index]!.checked) fireEvent.click(rowBoxes()[index]!);
    }
    expect(checkedCount()).toBe(2);
    // 计数文案的量词在 R4 里从「项」改成了「份」，本条只关心"勾了两份"，不跟着量词改断言。
    // 断言里的文案一律走 `t()`：这个仓库的 CJK 棘轮会数 ByText 家族里的中文字面量。
    expect(
      screen.getByText(
        t("resumesPage.list.group.selectionSummaryPlain", { count: 2 }),
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("resumesPage.batch.actions") }));
    fireEvent.click(
      // 菜单项带图标（`<span role="img" aria-label="delete">`），可读名是「delete 批量删除」，
      // 所以用正则而不是整串相等——与上方 P2-2 用例、跨页用例同一口径。
      await screen.findByRole("menuitem", {
        name: new RegExp(t("resumesPage.batchDelete.button")),
      }),
    );
    const confirmRoot = await waitFor(
      () => {
        const root = document.querySelector(".ant-modal-confirm");
        expect(root).not.toBeNull();
        return root as HTMLElement;
      },
      { timeout: 5000 },
    );
    // antd 会在两个汉字的按钮文字之间插空格（「删 除」），所以按字符拼一个宽松正则。
    const deleteLabel = new RegExp(t("common.action.delete").split("").join("\\s*"));
    fireEvent.click(within(confirmRoot).getByRole("button", { name: deleteLabel }));

    // 不能说"已删除 2 份"：只删了 1 份，另有 1 条被跳过。两个数字都要出现在同一条提示里，
    // 否则用户会以为"选了 2 份却只少了一条"是丢数据。
    const skippedLabel = t("applyUi.batch.skipped", { count: 1 });
    const toast = await screen.findByText(
      (content) => content.includes(skippedLabel),
      {},
      { timeout: 5000 },
    );
    expect(toast.textContent).toContain(t("resumesPage.batchDelete.done", { count: 1 }));
  });

  it("空选时「批量操作」不可用；退出选择清空选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    renderResumesPage();

    // 必须先等数据加载完成：右键菜单要挂在数据行上，行没渲染出来右键是空操作。
    // 顺带钉住 R8 口径：工具栏不再有直接的「批量选择」按钮。
    expect(screen.queryByRole("button", { name: /批量选择/ })).not.toBeInTheDocument();
    await enterSelectingViaContextMenu();
    const actionsBtn = await screen.findByRole("button", { name: "批量操作" }, { timeout: 5000 });
    // R4 起右键进入多选就顺手勾上了那一行，所以"空选"要先把它取消掉再断言。
    expect(checkedRowCount()).toBe(1);
    const rowCheckbox = () => screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(rowCheckbox()[1]!);
    expect(checkedRowCount()).toBe(0);
    expect(
      screen.getByText(t("resumesPage.batch.selected", { count: 0 })),
    ).toBeInTheDocument();
    expect(actionsBtn).toBeDisabled();

    fireEvent.click(rowCheckbox()[1]!);
    expect(
      screen.getByText(t("resumesPage.batch.selected", { count: 1 })),
    ).toBeInTheDocument();
    // 重新查一次按钮：勾选会重渲操作条，别对旧节点断言。
    expect(screen.getByRole("button", { name: "批量操作" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "退出选择" }));
    expect(screen.queryByText(t("resumesPage.batch.selected", { count: 1 }))).toBeNull();
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

    expect(
      await screen.findByText(t("resumesPage.selectAll.done", { count: 3 })),
    ).toBeInTheDocument();
    // 跨页全选是**整体替换**选区：右键时勾上的那 1 份被这 3 份替换掉，不是 4 份。
    expect(
      screen.getByText(t("resumesPage.batch.selected", { count: 3 })),
    ).toBeInTheDocument();
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
    // R4：右键进入多选已经勾上这一份，所以"不进入选区"要按**选区没变**来断言
    // （5001 个 id 一个都没进来），而不是"计数是 0"。
    expect(checkedRowCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    // 文案对齐岗位广场：说明总数、上限（与后端批量端点一致的 5000）与出路（先筛选缩小范围）。
    expect(
      await screen.findByText(t("resumesPage.selectAll.tooMany", { count: 5001 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("resumesPage.batch.selected", { count: 1 })),
    ).toBeInTheDocument();
    expect(apiMocks.batchDeleteResumes).not.toHaveBeenCalled();
  });

  it("当前筛选下没有简历时提示为空，不改动选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    apiMocks.listResumeIds.mockResolvedValue([]);
    renderResumesPage();

    await enterSelectingViaContextMenu();
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    expect(await screen.findByText(t("resumesPage.selectAll.empty"))).toBeInTheDocument();
    expect(
      screen.getByText(t("resumesPage.batch.selected", { count: 1 })),
    ).toBeInTheDocument();
  });
});
