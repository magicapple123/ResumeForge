// SPDX-License-Identifier: Apache-2.0
/** 简历预览弹窗的关联上下文行（RF-11）：有 job_id 给三段直达链接，通用简历没有。 */
import { App as AntdApp } from "antd";
import * as antd from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDetail, ResumeLayout } from "../types";
import ResumeDetailModal from "./ResumeDetailModal";

const apiMocks = vi.hoisted(() => ({
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  fetchResumeTemplates: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  updateResumeLayout: vi.fn(),
  listResumeDeliveries: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
// 预览主体是另一批测试的对象；这里只关心弹窗自己的上下文行与**版式重排**。
// 桩里多给两个按钮：宿主层的"连续两次改版式"必须由本文件主动触发 `onApplyLayout`，
// 否则只能靠真控件（那一层已有自己的测试）。`data-page-limit` 让"草稿有没有前进"可观察。
vi.mock("./resume/ResumeDetailPreview", () => ({
  default: ({
    layout,
    onApplyLayout,
  }: {
    layout: ResumeLayout;
    onApplyLayout: (next: ResumeLayout) => void;
  }) => (
    <div data-testid="resume-preview-stub" data-page-limit={layout.page_limit}>
      <button type="button" onClick={() => onApplyLayout({ ...layout, page_limit: 2 })}>
        改版式·2 页
      </button>
      <button type="button" onClick={() => onApplyLayout({ ...layout, page_limit: 3 })}>
        改版式·3 页
      </button>
    </div>
  ),
}));

function makeDetail(overrides: Partial<ResumeDetail>): ResumeDetail {
  return {
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
    content: {
      photo: "",
      name: "",
      gender: "",
      birth_year: "",
      phone: "",
      email: "",
      city: "",
      personal_website: "",
      github: "",
      job_intent: "",
      summary: "",
      education: [],
      experience: [],
      campus_experience: [],
      projects: [],
      skills: [],
      awards: [],
    },
    warnings: [],
    parse_error: "",
    parent_revision_id: null,
    rationale: "",
    coverage_notes: [],
    ...overrides,
  };
}

function renderModal(recordId: number | null) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailModal recordId={recordId} onClose={vi.fn()} />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue({ pdf_direct_available: true });
  apiMocks.listResumeDeliveries.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeDetailModal 关联上下文行（RF-11）", () => {
  it("有 job_id：三段直达链接都带着该岗位的 id", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByTestId("resume-preview-stub")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "查看关联岗位" })).toHaveAttribute(
      "href",
      "/jobs?job_id=3",
    );
    expect(screen.getByRole("link", { name: "该岗位的投递进度" })).toHaveAttribute(
      "href",
      "/tracker?job_id=3",
    );
    expect(screen.getByRole("link", { name: "模拟面试" })).toHaveAttribute(
      "href",
      "/interview?job_id=3",
    );
  });

  it("通用简历（无 job_id）：不渲染上下文行", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({ job_id: null }));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByTestId("resume-preview-stub")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "查看关联岗位" })).toBeNull();
    expect(screen.queryByRole("link", { name: "该岗位的投递进度" })).toBeNull();
    expect(screen.queryByRole("link", { name: "模拟面试" })).toBeNull();
  });
});

/** 版本信息位（RF-17）：血缘与投递记录的诚实口径。 */
describe("ResumeDetailModal 版本信息位（RF-17）", () => {
  it("无血缘无投递：显示「独立版本」，不臆造历史", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByTestId("resume-delivery-info")).toBeInTheDocument());
    expect(screen.getByText("独立版本，暂无投递记录")).toBeInTheDocument();
  });

  it("有血缘：以 id 如实表述派生关系，不猜父简历标题", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({ parent_revision_id: 5 }));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");

    renderModal(8);

    await waitFor(() => expect(screen.getByText("派生自简历 #5")).toBeInTheDocument());
  });

  it("有投递记录：逐条显示「已投递给谁 · 来源 · 时间 · 指纹前 8 位」", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");
    apiMocks.listResumeDeliveries.mockResolvedValue([
      {
        id: 1,
        created_at: "2026-10-11T08:00:00",
        source: "apply",
        job_title: "后端开发实习生",
        company: "示例科技",
        resume_title: "后端岗位简历",
        export_format: "",
        filename: "",
        pages: null,
        content_sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        rendered_config_sha256: "f".repeat(64),
      },
    ]);

    renderModal(8);

    await waitFor(() =>
      // PR-09 文案契约：apply 是唯一显示「已投递给」的来源（三态语义区分）。
      expect(screen.getByText(/已投递给\s*示例科技 · 后端开发实习生 · 投递台/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
    expect(listResumeDeliveriesCalledWith(8)).toBe(true);
  });
});

function listResumeDeliveriesCalledWith(id: number): boolean {
  return apiMocks.listResumeDeliveries.mock.calls.some((call) => call[0] === id);
}

/**
 * 版式重排（项 6 / D11）：**尾随合并** + "草稿只在渲染成功后前进"。
 *
 * 这两条一起守住的是一类很难复现的体感问题：拖动时中间态不该逐个渲染（浪费且卡），
 * 而读数也不该跑到画面前面去（用户会以为"改了没生效"）。
 */
describe("ResumeDetailModal 版式重排（P3）", () => {
  function deferred() {
    let resolve!: (html: string) => void;
    const promise = new Promise<string>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("连续两次改版式：在飞时只渲染一次，渲染成功后草稿才是最后一次", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");
    const gate = deferred();
    apiMocks.renderResume.mockReturnValueOnce(gate.promise).mockResolvedValue("<p>新版式</p>");

    renderModal(8);
    const stub = await screen.findByTestId("resume-preview-stub");
    expect(stub).toHaveAttribute("data-page-limit", "1");

    fireEvent.click(screen.getByRole("button", { name: "改版式·2 页" }));
    fireEvent.click(screen.getByRole("button", { name: "改版式·3 页" }));

    // 第一次还在飞：第二次只进"待渲染"，不重复发请求。
    // 用 waitFor 只等"首帧渲染请求已发出"这一个异步边界（断言内容不变）：全量并行跑时
    // React effect 的冲刷可能晚于同步断言，直接同步断言会偶发假失败（2026-10-25 实测）。
    await waitFor(() => expect(apiMocks.renderResume).toHaveBeenCalledTimes(1));
    // 草稿没有前进：读数仍是旧值（渲染中不谎报"已生效"）。
    expect(screen.getByTestId("resume-preview-stub")).toHaveAttribute("data-page-limit", "1");

    await act(async () => {
      gate.resolve("<p>新版式</p>");
      await gate.promise;
    });

    // 尾随合并：只补跑"最后那一版"，中间那一次（2 页）从未渲染。
    await waitFor(() => expect(apiMocks.renderResume).toHaveBeenCalledTimes(2));
    expect(apiMocks.renderResume.mock.calls[1][1]).toMatchObject({ page_limit: 3 });
    await waitFor(() =>
      expect(screen.getByTestId("resume-preview-stub")).toHaveAttribute("data-page-limit", "3"),
    );
  });

  it("渲染失败：提示原因，不重试，草稿停在原处", async () => {
    apiMocks.getResume.mockResolvedValue(makeDetail({}));
    apiMocks.fetchResumeHtml.mockResolvedValue("<p>预览</p>");
    apiMocks.renderResume.mockRejectedValueOnce(new Error("后端渲染失败"));

    renderModal(8);
    await screen.findByTestId("resume-preview-stub");

    // 断言"错误被报出来"的**调用**，而不是等它渲染成 DOM。
    //
    // 这条用例此前靠 `findByText("后端渲染失败")`：文案由 `App.useApp()` 的 message 实例
    // 挂到 body，中间隔着 portal 挂载与进场动画，而全量并行时 CPU 饱和——预算从 1s 加到
    // 3s 仍偶发红，加到 8s 才稳。那不是"链路慢"，是**断言依赖了渲染时序**。
    //
    // 2026-11 复盘：改成 spy 之后渲染时序已经解耦，但 3000 仍会偶发红（实测单跑 14 次红 1 次，
    // 与 `ResumeDetailModal` 的改动无关：那条路径上既没有新增请求，也没有新增 effect）。
    // 所以这里把**下面那个 waitFor** 的预算按上面这段结论对齐到 8s——改的是预算，不是断言：
    // 断言仍是"error 被调用过且原因是后端那条"，一次都不许少。
    // 注意要 spy `App.useApp` 返回的实例（组件用的不是 antd 的静态 `message`）。
    const errorSpy = vi.fn();
    const useAppSpy = vi.spyOn(antd.App, "useApp").mockReturnValue({
      message: { error: errorSpy, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
    } as unknown as ReturnType<typeof antd.App.useApp>);

    fireEvent.click(screen.getByRole("button", { name: "改版式·2 页" }));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("后端渲染失败"), { timeout: 8000 });
    useAppSpy.mockRestore();

    // 不自动重试（失败 → 重试 → 再失败会变死循环）。
    await waitFor(() => expect(apiMocks.renderResume).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("resume-preview-stub")).toHaveAttribute("data-page-limit", "1");
  });
});
