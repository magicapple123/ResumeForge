import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeBrief } from "../types";
import ResumesPage from "./ResumesPage";

const apiMocks = vi.hoisted(() => ({
  deleteResume: vi.fn(),
  batchDeleteResumes: vi.fn(),
  listResumes: vi.fn(),
  listResumeIds: vi.fn(),
  updateResumeFavorite: vi.fn(),
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
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
  fetchResumeHtml: apiMocks.fetchResumeHtml,
  renderResume: apiMocks.renderResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

// 深链用例只关心"详情弹窗开了没有、URL 参数有没有清掉"；预览主体是重渲染路径，
// 由它自己的测试负责，这里桩掉。
vi.mock("../components/resume/ResumeDetailPreview", () => ({
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
};

function renderPage(initialEntries: string[] = ["/resumes"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <ResumesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
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
  apiMocks.fetchResumeHtml.mockReset().mockResolvedValue("<p>预览</p>");
  apiMocks.renderResume.mockReset().mockResolvedValue("<p>预览</p>");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage column hints", () => {
  it("explains what a beauty-enhancement level actually did on hover", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, enhancement_enabled: true, enhancement_level: "balanced" }],
      total: 1,
    });
    renderPage();
    await screen.findByText(RESUME.title);

    // “均衡”两个字本身说明不了什么，悬停要给出这一档做了什么。
    fireEvent.mouseEnter(screen.getByText("均衡"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("补足方法、技术细节与成果表达");
  });

  it("explains what a general resume is on hover", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [{ ...RESUME, job_id: null, job_title: "软件开发" }],
      total: 1,
    });
    renderPage();
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
    renderPage();
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
    renderPage();
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
    renderPage();

    const row = (await screen.findByText(RESUME.title)).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("通用简历")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("求职意向：后端开发")).toBeInTheDocument();
    // 有岗位时岗位名是一个可点击跳转的按钮；通用简历不该有
    expect(within(row as HTMLElement).queryByRole("button", { name: RESUME.job_title })).toBeNull();
  });

  it("keeps job-linked records linking to their job", async () => {
    renderPage();

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
    renderPage();
    await screen.findByText(RESUME.title);

    expect(screen.getByText("重点跟进，本周五前回复")).toBeInTheDocument();
  });
});

describe("ResumesPage 行操作（三点菜单已移除）", () => {
  it("行内不再有三点「更多操作」按钮；右键菜单仍含全部次级操作", async () => {
    renderPage();
    const title = await screen.findByText(RESUME.title);

    expect(screen.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);
    expect(await screen.findByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "编辑备注" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "版本对比" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("键盘可达：聚焦行内元素时按 ContextMenu 键打开同一份右键菜单", async () => {
    renderPage();
    const title = await screen.findByText(RESUME.title);

    fireEvent.keyDown(title.closest("tr") as HTMLElement, { key: "ContextMenu", bubbles: true });
    expect(await screen.findByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
  });
});

describe("ResumesPage URL 状态化", () => {
  it("从 URL 恢复关键词筛选（收藏状态筛选已移除，走收藏夹）", async () => {
    renderPage(["/resumes?keyword=%E5%88%B6%E9%80%A0"]);

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
    renderPage(["/resumes?resume_id=8"]);

    expect(await screen.findByTestId("resume-preview-stub")).toBeInTheDocument();
    expect(apiMocks.getResume).toHaveBeenCalledWith(8);
    expect(apiMocks.fetchResumeHtml).toHaveBeenCalledWith(8);
  });

  it("非法 resume_id 忽略：不打开弹窗、不取详情", async () => {
    renderPage(["/resumes?resume_id=abc"]);

    await screen.findByText(RESUME.title);
    expect(screen.queryByTestId("resume-preview-stub")).toBeNull();
    expect(apiMocks.getResume).not.toHaveBeenCalled();
  });

  it("关闭弹窗时从 URL 移除 resume_id 参数（replace，不打历史）", async () => {
    renderPageWithProbe(["/resumes?resume_id=8"]);
    await screen.findByTestId("resume-preview-stub");

    // antd 弹窗右上角的关闭键可访问名是 Close。
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // 只断 URL：jsdom 里 antd 的离场动画等不到 transitionend，弹窗内容不会真正
    // 卸载（onClose 已同步触发），断 DOM 移除会假红。
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).not.toContain("resume_id"),
    );
    expect(screen.getByTestId("location").textContent).toBe("/resumes");
  });
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
    renderPage();

    // CI 慢机上数据晚于表格就绪——先等第一条数据渲染出来再右键进入多选（5s 安全网）。
    await enterSelectingViaContextMenu();
    // 勾选走 rowSelection 自带的表头/行勾选框（2026-10-16 起 BatchActionBar 的重复
    // 「全选本页」已按用户要求移除，表格表头那个是唯一入口）。rowSelection 的表头
    // 全选框与数据行勾选框都叫「全选本页」/ 行标题，全部现查现点（重渲会重建 DOM）。
    const rowBoxes = () => screen.getAllByRole("checkbox");
    fireEvent.click(rowBoxes()[1]!);
    fireEvent.click(rowBoxes()[2]!);
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    expect(
      (await screen.findAllByText(/删除选中的 2 份简历/, {}, { timeout: 5000 })).length,
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
    expect(confirmRoot.textContent).toContain("删除选中的 2 份简历");
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

  it("空选时「批量删除」不可用；退出多选清空选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    renderPage();

    // 必须先等数据加载完成：右键菜单要挂在数据行上，行没渲染出来右键是空操作。
    // 顺带钉住 R8 口径：工具栏不再有直接的「批量选择」按钮。
    expect(screen.queryByRole("button", { name: /批量选择/ })).not.toBeInTheDocument();
    await enterSelectingViaContextMenu();
    const deleteBtn = await screen.findByRole("button", { name: "批量删除" }, { timeout: 5000 });
    expect(deleteBtn).toBeDisabled();

    const rowCheckbox = screen.getAllByRole("checkbox")[1]!;
    fireEvent.click(rowCheckbox);
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
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
    renderPage();

    await enterSelectingViaContextMenu();
    // 按钮上的 N 取列表端点的 total，而不是当前页条数。
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    expect(await screen.findByText(/已选中当前筛选下的全部 3 份简历/)).toBeInTheDocument();
    expect(screen.getByText("已选 3 项")).toBeInTheDocument();
    expect(apiMocks.listResumeIds).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "", has_job: undefined }),
    );

    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    const confirmRoot = await waitFor(() => {
      const root = document.querySelector(".ant-modal-confirm");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(confirmRoot.textContent).toContain("删除选中的 3 份简历");
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
    renderPage();

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
    renderPage();

    await enterSelectingViaContextMenu();
    fireEvent.click(screen.getByRole("button", { name: "全选全部简历（共 1 个）" }));

    expect(await screen.findByText("当前筛选下没有简历")).toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
  });
});
