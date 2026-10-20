// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试页回归（用户实测三连 bug 中的两个）：
 *
 * 1. **自动轮数 422**：选「自动」时 rounds_min 曾提交模式开关值 1，被后端
 *    `rounds_min ≥ 3` 拦下（"Input should be greater than or equal to 3"）。
 *    现契约：rounds_min 提交 MIN_INTERVIEW_ROUNDS（=3，AI 最早第 3 轮起可收尾），
 *    rounds 提交 AUTO_FINISH_MAX_ROUNDS（=12，服务端硬性保险），且恒有
 *    rounds_min < rounds。
 * 2. **提交回答 404**：回答走 SSE 流式（consumeSSE 不像 request() 会自动补 /api
 *    前缀），漏前缀会打到前端自身源上 → 「请求失败（HTTP 404）」。钉住 URL 必须是
 *    `/api/interview/{id}/answers/stream`，且后端 404 detail（"面试不存在或已被删除"）
 *    原样展示给用户；创建失败（422）则留在设置页、错误可见，绝不进面试界面。
 *
 * SetupTab 用桩替身直接回调 onStart：被测的是 InterviewPage 的 payload 映射与错误
 * 处理，不是 antd 表单交互；题库/面经/复盘面板与报告卡同样桩掉（各自有自己的测试）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { InterviewDetail } from "../types";
import InterviewPage from "./InterviewPage";

const apiMocks = vi.hoisted(() => ({
  listInterviews: vi.fn(),
  createInterview: vi.fn(),
  getInterview: vi.fn(),
  deleteInterview: vi.fn(),
  finishInterview: vi.fn(),
  interviewToMaterial: vi.fn(),
}));

/** consumeSSE 替身：只在此文件的用例里注入行为；真实实现另有 stream.test.ts 守着。 */
const streamMocks = vi.hoisted(() => ({ consumeSSE: vi.fn() }));

// 真实导出铺开再覆盖要 mock 的几个：页面一旦导入新函数而替身没有，报错会指向页面
// 代码而不是替身（AssistantPage.test 的同款做法）。
vi.mock("../api/interview", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...apiMocks,
}));
vi.mock("../api/stream", () => streamMocks);
vi.mock("../components/QuestionBankPanel", () => ({ default: () => <div>题库面板</div> }));
vi.mock("../components/InterviewExperiencePanel", () => ({ default: () => <div>面经面板</div> }));
vi.mock("../components/InterviewReviewPanel", () => ({ default: () => <div>复盘面板</div> }));
vi.mock("./interview/ReportCard", () => ({ ReportCard: () => <div>评分报告</div> }));

// SetupTab 桩：AUTO_ROUNDS_OPTION 的值必须与真实模块一致（InterviewPage 靠它分流）。
const setupStubs = vi.hoisted(() => {
  const base = {
    jobId: undefined,
    interviewType: "综合面",
    difficulty: "中级",
    interviewerStyle: "严谨专业",
    focus: "",
    persona: "",
  };
  return {
    AUTO_ROUNDS_OPTION: "auto",
    autoValues: { ...base, rounds: "auto" as const },
    fixedValues: { ...base, rounds: 6 },
  };
});

vi.mock("./interview/SetupTab", () => ({
  AUTO_ROUNDS_OPTION: setupStubs.AUTO_ROUNDS_OPTION,
  SetupTab: ({ onStart }: { onStart: (values: Record<string, unknown>) => void }) => (
    <div>
      <button type="button" onClick={() => onStart(setupStubs.autoValues)}>
        自动开始（桩）
      </button>
      <button type="button" onClick={() => onStart(setupStubs.fixedValues)}>
        固定开始（桩）
      </button>
    </div>
  ),
}));

function makeDetail(overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: 7,
    title: "综合面 · 中级",
    job_id: null,
    job_title: "",
    company: "",
    interview_type: "综合面",
    difficulty: "中级",
    interviewer_style: "严谨专业",
    rounds: 6,
    rounds_min: null,
    status: "active",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    answered_rounds: 0,
    persona: "",
    focus: "",
    model: "test-model",
    report: {},
    messages: [
      {
        id: 1,
        role: "interviewer",
        content: "请先做一个简单的自我介绍。",
        context: {},
        status: "done",
        error: "",
        created_at: "2026-01-01T00:00:00",
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <InterviewPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  // InterviewPage 的新消息滚动 effect 依赖 scrollIntoView，jsdom 未实现。
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  apiMocks.listInterviews.mockResolvedValue([]);
  apiMocks.createInterview.mockReset();
  apiMocks.getInterview.mockReset();
  streamMocks.consumeSSE.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InterviewPage：自动轮数提交契约", () => {
  it("选「自动」：rounds_min 提交 3（后端下限），rounds 提交硬性保险 12", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail({ rounds: 12, rounds_min: 3 }));
    renderPage();

    fireEvent.click(await screen.findByText("自动开始（桩）"));

    await waitFor(() => expect(apiMocks.createInterview).toHaveBeenCalledTimes(1));
    expect(apiMocks.createInterview).toHaveBeenCalledWith(
      expect.objectContaining({
        interview_type: "综合面",
        rounds: 12,
        rounds_min: 3, // 曾经提交 1 → 后端 422："should be greater than or equal to 3"
      }),
    );
    // 自动模式界面：不显示总轮数，提示按表现收尾。
    expect(await screen.findByText("第 1 轮 · 面试官按表现收尾")).toBeInTheDocument();
  });

  it("固定 6 轮：rounds_min 为 null（固定轮数模式不受影响）", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    renderPage();

    fireEvent.click(await screen.findByText("固定开始（桩）"));

    await waitFor(() => expect(apiMocks.createInterview).toHaveBeenCalledTimes(1));
    expect(apiMocks.createInterview).toHaveBeenCalledWith(
      expect.objectContaining({ rounds: 6, rounds_min: null }),
    );
    expect(await screen.findByText("第 1 / 6 轮")).toBeInTheDocument();
  });
});

describe("InterviewPage：创建失败与提交回答的错误链路", () => {
  it("创建失败（后端 422）：错误可见，留在设置页，不进入面试界面", async () => {
    apiMocks.createInterview.mockRejectedValue(
      new Error("Input should be greater than or equal to 3"),
    );
    renderPage();

    fireEvent.click(await screen.findByText("自动开始（桩）"));

    expect(
      await screen.findByText("Input should be greater than or equal to 3"),
    ).toBeInTheDocument();
    // 关键不变量：失败绝不乐观进入面试房间（否则之后的回答必然 404）。
    expect(screen.queryByText("回到设置")).toBeNull();
    expect(screen.getByText("自动开始（桩）")).toBeInTheDocument();
  });

  it("提交回答：流式请求带 /api 前缀；后端 404 detail 原样展示，回答放回输入框", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    streamMocks.consumeSSE.mockRejectedValue(new ApiError("面试不存在或已被删除", 404));
    renderPage();

    fireEvent.click(await screen.findByText("固定开始（桩）"));
    const textarea = await screen.findByPlaceholderText(/像真实面试那样回答/);
    fireEvent.change(textarea, { target: { value: "不知道" } });
    fireEvent.click(screen.getByText("提交回答"));

    await waitFor(() => expect(streamMocks.consumeSSE).toHaveBeenCalledTimes(1));
    const [url] = streamMocks.consumeSSE.mock.calls[0] as [string];
    // 曾经漏 /api 前缀 → POST 打到前端源 → 「请求失败（HTTP 404）」。
    expect(url).toBe("/api/interview/7/answers/stream");
    // 用户看到的是后端 detail，不是干巴巴的状态码。
    expect(await screen.findByText("面试不存在或已被删除")).toBeInTheDocument();
    // 回答已放回输入框，用户可以直接重试（页面 catch 的既有约定）。
    await waitFor(() => expect(textarea).toHaveValue("不知道"));
  });
});
