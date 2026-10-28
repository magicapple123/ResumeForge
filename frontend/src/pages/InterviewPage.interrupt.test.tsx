// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试「停止本轮 + 重新回答」（T04-c）。
 *
 * 面试是强交互流式：用户消息先落库，面试官那句回应再流式生成。这一轮必须能中途停下
 * （否则用户只能等十几秒），而且停下之后状态要一致：
 * - 页面立刻回到可继续提问的状态（输入框可用、按钮变回「提交回答」）；
 * - 用户那句话**留在屏幕上**，并标成"这一轮没有答完 + 重新回答"；
 * - 重新回答走的是原来的提问链路（同一个端点、同一段内容），不新开端点。
 *
 * 刷新/重新进入页面看到的历史也是同一条渲染路径：服务端把那一轮的 ``status`` 记成
 * ``interrupted``，列表据此显示标记与重答入口。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
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

const streamMocks = vi.hoisted(() => ({ consumeSSE: vi.fn() }));

vi.mock("../api/interview", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...apiMocks,
}));
vi.mock("../api/stream", () => streamMocks);
vi.mock("../components/QuestionBankPanel", () => ({ default: () => <div>题库面板</div> }));
vi.mock("../components/InterviewExperiencePanel", () => ({ default: () => <div>面经面板</div> }));
vi.mock("../components/InterviewReviewPanel", () => ({ default: () => <div>复盘面板</div> }));
vi.mock("./interview/ReportCard", () => ({ ReportCard: () => <div>评分报告</div> }));
vi.mock("./interview/SetupTab", () => ({
  AUTO_ROUNDS_OPTION: "auto",
  SetupTab: ({ onStart }: { onStart: (values: Record<string, unknown>) => void }) => (
    <button
      type="button"
      onClick={() =>
        onStart({
          jobId: 3,
          resumeId: 5,
          interviewType: "综合面",
          difficulty: "中级",
          interviewerStyle: "严谨专业",
          focus: "",
          persona: "",
          rounds: 6,
        })
      }
    >
      固定开始（桩）
    </button>
  ),
}));

const ANSWER = "我用 Redis 做了缓存分层，QPS 从 800 提到 3600";

function makeDetail(overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: 7,
    title: "综合面 · 中级",
    job_id: 3,
    job_title: "后端开发工程师",
    company: "示例公司",
    resume_id: 5,
    resume_title: "后端版简历",
    duration_seconds: 0,
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
        status: "complete",
        error: "",
        created_at: "2026-01-01T00:00:00",
      },
    ],
    ...overrides,
  };
}

/** 一个"永远不结束"的流：只有 abort 才会拒绝，模拟模型正在生成下一题。 */
function pendingStreamUntilAbort() {
  return (_url: string, _body: unknown, _onEvent: unknown, signal?: AbortSignal): Promise<void> =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
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

/** 进房间、过「准备好了」闸门、把作答区准备好（这几步每条用例都要走）。 */
async function enterRoom() {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /固定开始/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(t("interviewPage.ready.start")) }),
  );
  return screen.findByPlaceholderText(/像真实面试那样回答/);
}

beforeEach(() => {
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

describe("InterviewPage：停止本轮", () => {
  it("生成中可点「停止本轮」：点完立刻回到可提问状态，并给出「重新回答」", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    streamMocks.consumeSSE.mockImplementation(pendingStreamUntilAbort());
    const textarea = await enterRoom();

    fireEvent.change(textarea, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: t("interview.action.submit") }));

    // 生成中：主按钮换成「停止本轮」（"可以不等"），输入框禁用。
    const stop = await screen.findByRole("button", {
      name: new RegExp(t("interview.action.stopRound")),
    });
    expect(textarea).toBeDisabled();

    fireEvent.click(stop);

    // 中断后：那句话还在屏上，带"没答完"的标记和重答入口；作答区回到可继续提问的状态。
    expect(await screen.findByText(t("interview.interrupted.hint"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(t("interview.action.retryRound")) }),
    ).toBeEnabled();
    expect(
      await screen.findByRole("button", { name: t("interview.action.submit") }),
    ).toBeInTheDocument();
    // 输入框不再禁用，且「停止本轮」消失（这一轮已经不在跑了）。
    expect(textarea).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: new RegExp(t("interview.action.stopRound")) }),
    ).toBeNull();
    expect(screen.getByText(ANSWER)).toBeInTheDocument();
  });

  it("请求带 AbortSignal：abort 之后 fetch 会真的断开（服务端据此停止烧 token）", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    streamMocks.consumeSSE.mockImplementation(pendingStreamUntilAbort());
    const textarea = await enterRoom();

    fireEvent.change(textarea, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: t("interview.action.submit") }));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("interview.action.stopRound")) }),
    );

    const signal = streamMocks.consumeSSE.mock.calls[0]?.[3] as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it("「重新回答」走原来的提问链路：同一端点、同一段内容再提交一次", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    streamMocks.consumeSSE.mockImplementation(pendingStreamUntilAbort());
    const textarea = await enterRoom();

    fireEvent.change(textarea, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: t("interview.action.submit") }));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("interview.action.stopRound")) }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("interview.action.retryRound")) }),
    );

    await waitFor(() => expect(streamMocks.consumeSSE).toHaveBeenCalledTimes(2));
    const [url, body] = streamMocks.consumeSSE.mock.calls[1] as [string, { content: string }];
    expect(url).toBe("/api/interview/7/answers/stream");
    expect(body.content).toBe(ANSWER);
  });
});

describe("InterviewPage：历史里没答完的那一轮", () => {
  it("服务端标了 interrupted 的一轮：看得出「上次没答完」，且能重答", async () => {
    apiMocks.createInterview.mockResolvedValue(
      makeDetail({
        answered_rounds: 1,
        messages: [
          {
            id: 1,
            role: "interviewer",
            content: "请先做一个简单的自我介绍。",
            context: {},
            status: "complete",
            error: "",
            created_at: "2026-01-01T00:00:00",
          },
          {
            id: 2,
            role: "user",
            content: ANSWER,
            context: {},
            status: "interrupted",
            error: "",
            created_at: "2026-01-01T00:01:00",
          },
        ],
      }),
    );
    streamMocks.consumeSSE.mockImplementation(pendingStreamUntilAbort());
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /固定开始/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("interviewPage.ready.start")) }),
    );

    expect(await screen.findByText(t("interview.interrupted.hint"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interview.action.retryRound")) }),
    );

    await waitFor(() => expect(streamMocks.consumeSSE).toHaveBeenCalledTimes(1));
    const [, body] = streamMocks.consumeSSE.mock.calls[0] as [string, { content: string }];
    expect(body.content).toBe(ANSWER);
  });

  it("正常走完的一轮不显示「没答完」标记", async () => {
    apiMocks.createInterview.mockResolvedValue(
      makeDetail({
        answered_rounds: 1,
        messages: [
          {
            id: 1,
            role: "interviewer",
            content: "请先做一个简单的自我介绍。",
            context: {},
            status: "complete",
            error: "",
            created_at: "2026-01-01T00:00:00",
          },
          {
            id: 2,
            role: "user",
            content: ANSWER,
            context: {},
            status: "complete",
            error: "",
            created_at: "2026-01-01T00:01:00",
          },
        ],
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /固定开始/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("interviewPage.ready.start")) }),
    );

    expect(await screen.findByText(ANSWER)).toBeInTheDocument();
    expect(screen.queryByText(t("interview.interrupted.hint"))).toBeNull();
  });
});
