import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeBrief } from "../types";
import ResumesPage from "./ResumesPage";

const apiMocks = vi.hoisted(() => ({
  deleteResume: vi.fn(),
  listResumes: vi.fn(),
  updateResumeFavorite: vi.fn(),
}));

// 展开真实模块再覆盖：显式列导出时，生产代码新增一个导出就会让调用方直接抛
// "export is not defined"，看起来像组件崩了。
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  deleteResume: apiMocks.deleteResume,
  listResumes: apiMocks.listResumes,
  updateResumeFavorite: apiMocks.updateResumeFavorite,
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
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
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
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

describe("ResumesPage URL 状态化", () => {
  it("从 URL 恢复关键词与收藏筛选", async () => {
    renderPage(["/resumes?keyword=%E5%88%B6%E9%80%A0&favorite=0"]);

    await waitFor(() => {
      expect(apiMocks.listResumes).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: "制造", favorite: false }),
      );
    });
    const searchInput = screen.getByPlaceholderText("搜索简历记录") as HTMLInputElement;
    expect(searchInput.value).toBe("制造");
  });
});

describe("ResumesPage 批量选择", () => {
  it("进入多选 → 勾 2 项 → 删除所选 → 确认 → 每条各调一次删除接口", async () => {
    apiMocks.listResumes.mockResolvedValue({
      items: [RESUME, { ...RESUME, id: 9, title: "另一份简历" }],
      total: 2,
    });
    renderPage();

    // CI 慢机上「批量选择」按钮先于列表数据就绪（数据未到时它是 disabled，点它无效、
    // 表格还是 No data）——先等第一条数据渲染出来再进入多选，等待放宽到 5s 安全网。
    await screen.findByText(RESUME.title, {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "批量选择" }));
    // rowSelection 勾选框：第一个是表头全选，后两个是数据行。
    // 每次点击都会触发重渲染，必须现查现点（旧节点引用会失效）。
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getAllByRole("checkbox")[2]!);
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    expect(
      (await screen.findAllByText(/删除选中的 2 份简历/, {}, { timeout: 5000 })).length,
    ).toBeGreaterThan(0);
    // 未确认前绝不能删。
    expect(apiMocks.deleteResume).not.toHaveBeenCalled();
    // 确认弹窗里 antd 会把标题渲染两份（.ant-modal-title 与 .ant-modal-confirm-title），
    // 用文本查询会撞"Found multiple"——直接等容器出现，再在容器内点确认键
    // （okText「删除」被 antd 插空格成「删 除」；容器限定避免与操作条「删除所选」撞名）。
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

    await waitFor(() => expect(apiMocks.deleteResume).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    expect(await screen.findByText(/已删除 2 份简历/, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("空选时「删除所选」不可用；退出多选清空选区", async () => {
    apiMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "批量选择" }));
    const deleteBtn = screen.getByRole("button", { name: "删除所选" });
    expect(deleteBtn).toBeDisabled();

    const rowCheckbox = screen.getAllByRole("checkbox")[1]!;
    fireEvent.click(rowCheckbox);
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    expect(apiMocks.deleteResume).not.toHaveBeenCalled();
  });
});
