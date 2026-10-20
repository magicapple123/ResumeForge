// SPDX-License-Identifier: Apache-2.0
/**
 * R6：生成时定下的版式覆盖（板块顺序 / 字号系数）必须跟着生成请求走。
 *
 * 从 `GenerateResumeModal.test.tsx` 拆出（行数预算 500）。`vi.mock` 不跨文件
 * hoist，所以这里自带一份最小的 mock 脚手架（只保留本文件用到的 api 与夹具），
 * 用例外壳、断言与文案原样搬迁。
 */

import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeDetail, ResumeGenerateTask } from "../types";
import { resetBackgroundTasks } from "../utils/backgroundTasks";
import { registerNotifyHost } from "../utils/taskNotify";
import GenerateResumeModal from "./GenerateResumeModal";

/** 记录"完成提醒"的假宿主：本文件的用例断言的是请求参数，但组件需要一个通知宿主。 */
const notices: { title: string; modal?: boolean; confirmLabel?: string }[] = [];

const fakeNotifyHost = {
  notification: {
    success: (config: { title: unknown }) =>
      notices.push({ title: String(config.title), modal: false }),
    warning: (config: { title: unknown }) =>
      notices.push({ title: String(config.title), modal: false }),
    error: (config: { title: unknown }) =>
      notices.push({ title: String(config.title), modal: false }),
    info: (config: { title: unknown }) =>
      notices.push({ title: String(config.title), modal: false }),
  },
  modal: {
    info: (config: { title: unknown; okText?: unknown }) =>
      notices.push({
        title: String(config.title),
        modal: true,
        confirmLabel: config.okText ? String(config.okText) : undefined,
      }),
  },
};

const apiMocks = vi.hoisted(() => ({
  startResumeGeneration: vi.fn(),
  getResumeGenerateTask: vi.fn(),
  cancelResumeGenerateTask: vi.fn(),
  getResume: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  updateResumeLayout: vi.fn(),
  fetchResumeTemplates: vi.fn(),
  getLLMConfig: vi.fn(),
}));

vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  startResumeGeneration: apiMocks.startResumeGeneration,
  getResumeGenerateTask: apiMocks.getResumeGenerateTask,
  cancelResumeGenerateTask: apiMocks.cancelResumeGenerateTask,
  getResume: apiMocks.getResume,
  renderResume: apiMocks.renderResume,
  updateResume: apiMocks.updateResume,
  updateResumeLayout: apiMocks.updateResumeLayout,
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
}));
// 项 14 起版式栏里还有「简历字体」下拉，它会读已上传字体清单；这里给它一份空清单
// （本文件只关心版式覆盖怎么落库，字体选择由 ResumeFontControl.test.tsx 单独守）。
vi.mock("../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/settings")>()),
  getLLMConfig: apiMocks.getLLMConfig,
  listResumeFonts: vi.fn().mockResolvedValue({ items: [], active: null, max_bytes: 1 }),
}));

/** 一个正在运行的后台生成任务。用函数造值，让每个用例都能按需覆盖字段。 */
function makeTask(overrides: Partial<ResumeGenerateTask> = {}): ResumeGenerateTask {
  return {
    id: 1,
    status: "running",
    resume_id: null,
    error: "",
    message: "",
    received_chars: 0,
    job_id: null,
    title: "",
    created_at: "2025-01-01T00:00:00",
    started_at: "2025-01-01T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  notices.length = 0;
  // 登记表是模块级单例：不清的话，上一个用例留下的任务会被继续轮询。
  resetBackgroundTasks();
  registerNotifyHost(fakeNotifyHost as never);
  apiMocks.startResumeGeneration.mockReset();
  apiMocks.getResumeGenerateTask.mockReset();
  apiMocks.cancelResumeGenerateTask.mockReset();
  apiMocks.getResume.mockReset();
  apiMocks.renderResume.mockReset();
  apiMocks.updateResume.mockReset();
  apiMocks.updateResumeLayout.mockReset();
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.getLLMConfig.mockReset();
  apiMocks.getLLMConfig.mockResolvedValue({ base_url: "https://api.example.com/v1", model: "m" });
  apiMocks.startResumeGeneration.mockResolvedValue(makeTask());
  // 默认轮询返回"仍在运行"，避免无关用例误入终态分支。
  apiMocks.getResumeGenerateTask.mockResolvedValue(makeTask());
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
});

afterEach(() => {
  // 登记表是模块级单例，且它自己带一个 setInterval：不清空的话定时器会一直挂着，
  // 整个测试进程结束不了（实测卡了十几分钟）。
  resetBackgroundTasks();
  cleanup();
  document.body.innerHTML = "";
});

function renderModal(props: Partial<React.ComponentProps<typeof GenerateResumeModal>> = {}) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <GenerateResumeModal job={null} open onClose={vi.fn()} {...props} />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * R6：生成时定下的版式覆盖要跟着请求走。
 *
 * 用户在配置页把「项目经历」拖到最前、或把字号调到 5px，关掉弹窗再从简历中心重开时
 * 这两项都该还在——所以它们是**生成请求**的一部分，而不是预览期才拼进去的临时状态。
 */
describe("GenerateResumeModal 版式覆盖落库（R6）", () => {
  /** 资料页把「项目经历」拖到最前的那种顺序（与内置默认不同）。 */
  const PROFILE_ORDER = [
    "projects",
    "education",
    "summary",
    "experience",
    "campus_experience",
    "skills",
    "awards",
  ];

  /** 等目录回填完成：setLayout 在 fetch 的 then 里执行，再让出一轮微任务。 */
  async function waitForCatalog() {
    await waitFor(() => expect(apiMocks.fetchResumeTemplates).toHaveBeenCalled());
    // 让 then 回调里的 setLayout 真正落到状态上，避免与随后的"开始生成"抢时序。
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("资料顺序与内置默认不同时，把它作为 section_order 一起提交", async () => {
    apiMocks.fetchResumeTemplates.mockResolvedValue({
      ...TEMPLATE_CATALOG,
      profile_section_order: PROFILE_ORDER,
    });
    renderModal();
    await waitForCatalog();

    fireEvent.click(await screen.findByRole("button", { name: /开始生成/ }));

    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(apiMocks.startResumeGeneration.mock.calls[0][0].options.format_config).toEqual({
      section_order: PROFILE_ORDER,
    });
  });

  it("资料顺序等于内置默认时不写无意义的 section_order", async () => {
    renderModal();
    await waitForCatalog();

    fireEvent.click(await screen.findByRole("button", { name: /开始生成/ }));

    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(apiMocks.startResumeGeneration.mock.calls[0][0].options.format_config).toEqual({});
  });

  it("重新打开后仍然把同一份默认顺序发出去（回填是幂等的）", async () => {
    apiMocks.fetchResumeTemplates.mockResolvedValue({
      ...TEMPLATE_CATALOG,
      profile_section_order: PROFILE_ORDER,
    });
    const view = renderModal({ open: true });
    await waitForCatalog();

    view.rerender(
      <MemoryRouter>
        <AntdApp>
          <GenerateResumeModal job={null} open={false} onClose={vi.fn()} />
        </AntdApp>
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter>
        <AntdApp>
          <GenerateResumeModal job={null} open onClose={vi.fn()} />
        </AntdApp>
      </MemoryRouter>,
    );
    await waitForCatalog();

    fireEvent.click(await screen.findByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());
    expect(apiMocks.startResumeGeneration.mock.calls[0][0].options.format_config).toEqual({
      section_order: PROFILE_ORDER,
    });
  });
});

describe("GenerateResumeModal 回填只重算板块顺序（R6）", () => {
  /** rc-slider 读的是 keyCode/which，不是 key。 */
  function pressArrowRight(target: Element) {
    fireEvent.keyDown(target, { key: "ArrowRight", keyCode: 39, which: 39 });
  }

  it("重新打开时保留字号系数等其它覆盖，只把板块顺序重算成资料顺序", async () => {
    const view = renderModal({ open: true });
    await waitFor(() => expect(apiMocks.fetchResumeTemplates).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // 在配置阶段把字号往上调一格：14 → 14.1px（步长 0.1px），落库形态是「档位 + 系数」。
    const slider = await screen.findByRole("slider", { name: /字号/ });
    pressArrowRight(slider);
    // 断言滑块本身的值（读数与 tooltip 里也会出现 "14.1px"，按文本查会撞车）。
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "14.1"));
    // 等防抖（180ms）把这次拖动提交成一次 setLayout。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    view.rerender(
      <MemoryRouter>
        <AntdApp>
          <GenerateResumeModal job={null} open={false} onClose={vi.fn()} />
        </AntdApp>
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter>
        <AntdApp>
          <GenerateResumeModal job={null} open onClose={vi.fn()} />
        </AntdApp>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.startResumeGeneration).toHaveBeenCalledOnce());

    const formatConfig = apiMocks.startResumeGeneration.mock.calls[0][0].options.format_config;
    // 字号是用户的调整，不该被目录回填抹掉（那会让"关掉再打开字号变回去"）。
    // 14.1 / 14 ≈ 1.0071 → 系数量化到 3 位小数 1.007。
    expect(formatConfig.font_scale_adjust).toBeCloseTo(1.007, 2);
    // 板块顺序则按资料顺序重算；资料顺序等于内置默认时不写这个键。
    expect(formatConfig).not.toHaveProperty("section_order");
  });
});

/**
 * 预览期的版式重排（项 6 / D11 + C5）。
 *
 * 这一条专门守 C5 的第二种形态：原先 `applyLayout` 把 `setLayout(next)` 写在
 * "没有 detail / 正在重排"的守卫**之前**，于是出现"滑块读数已经是新值、画面还是旧版式"
 * ——比"整条丢弃"更隐蔽（保存后下次打开才看到跳变）。修法是把草稿推进统一挪到
 * `onRendered`，所以这里的核心断言是：**渲染没成功之前，读数不许前进**。
 */
describe("GenerateResumeModal 预览期版式重排（P3）", () => {
  const DETAIL: ResumeDetail = {
    id: 7,
    title: "生成出来的简历",
    job_id: null,
    job_title: "",
    company: "",
    source: "ai",
    favorite: false,
    note: "",
    model: "demo-model",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-10-20T08:00:00",
    content: {
      photo: "",
      name: "张三",
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
  };

  function deferred() {
    let resolve!: (html: string) => void;
    const promise = new Promise<string>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  /** 走完"生成 → 轮询到完成 → 进入预览阶段"这条真实链路。 */
  async function openPreview() {
    apiMocks.getResumeGenerateTask
      .mockResolvedValueOnce(makeTask({ status: "running" }))
      .mockResolvedValue(makeTask({ status: "completed", resume_id: 7 }));
    apiMocks.getResume.mockResolvedValue(DETAIL);
    apiMocks.renderResume.mockResolvedValue("<div>预览HTML</div>");
    apiMocks.updateResumeLayout.mockResolvedValue({});

    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: /开始生成/ }));
    await waitFor(() => expect(apiMocks.getResume).toHaveBeenCalledWith(7));
    // 版式控件出现即说明已经在预览阶段（配置阶段的页数选择器也是这三个，所以再用
    // 「重新生成」按钮确认一次）。
    await screen.findByRole("button", { name: /重新生成/ });
  }

  it("连续两次改版式只渲染 2 次，且读数在渲染成功前不前进", async () => {
    await openPreview();

    // 预览加载用掉的那一次渲染不算在内：从这里开始记账。
    apiMocks.renderResume.mockReset();
    const gate = deferred();
    apiMocks.renderResume.mockReturnValueOnce(gate.promise).mockResolvedValue("<div>新版式</div>");

    fireEvent.click(screen.getByText("2 页"));
    fireEvent.click(screen.getByText("3 页"));

    // 第一次还在飞：第二次只进"待渲染"，不重复发请求。
    expect(apiMocks.renderResume).toHaveBeenCalledTimes(1);
    // **C5 的核心**：读数没有前进，仍停在 1 页。旧实现在这里已经是 3 页了。
    expect(screen.getByText("1 页").closest("label")).toHaveClass("ant-segmented-item-selected");
    expect(screen.getByText("3 页").closest("label")).not.toHaveClass(
      "ant-segmented-item-selected",
    );
    // 记录也还没写回（写回与"生效"必须是同一时刻）。
    expect(apiMocks.updateResumeLayout).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve("<div>新版式</div>");
      await gate.promise;
    });

    // 尾随合并：只补跑最后那一版（2 页从未渲染）。
    await waitFor(() => expect(apiMocks.renderResume).toHaveBeenCalledTimes(2));
    expect(apiMocks.renderResume.mock.calls[1][1]).toMatchObject({ page_limit: 3 });
    await waitFor(() =>
      expect(apiMocks.updateResumeLayout).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ page_limit: 3 }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("3 页").closest("label")).toHaveClass("ant-segmented-item-selected"),
    );
  });
});
