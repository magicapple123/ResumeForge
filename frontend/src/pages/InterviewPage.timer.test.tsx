// SPDX-License-Identifier: Apache-2.0
/**
 * 面试计时器的界面契约（0066）：
 *
 * 1. 进房间先看到「准备好了」闸门，**计时器不出现**（点「开始面试」不等于开始计时）；
 * 2. 点「准备好了」之后计时器出现，并且真的在走（推进 65s → 01:05）；
 * 3. 退出房间再进来又回到闸门（离开的那段不该被悄悄算进时长）。
 *
 * 全程用假定时器：走表就是 1s 一跳，用真时间等 65 秒既慢又不稳。相应地不能用
 * `findBy*`（它的 waitFor 也依赖定时器），改用 `act` 手动冲微任务 + `getBy*`。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  updateInterviewDuration: vi.fn(),
}));

const streamMocks = vi.hoisted(() => ({ consumeSSE: vi.fn() }));

vi.mock("../api/interview", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...apiMocks,
}));
vi.mock("../api/stream", () => streamMocks);
vi.mock("../components/QuestionBankPanel", () => ({ default: () => <div>bank</div> }));
vi.mock("../components/InterviewExperiencePanel", () => ({ default: () => <div>exp</div> }));
vi.mock("../components/InterviewReviewPanel", () => ({ default: () => <div>review</div> }));
vi.mock("./interview/ReportCard", () => ({ ReportCard: () => <div>report</div> }));

const setupStubs = vi.hoisted(() => {
  const base = {
    jobId: 3,
    resumeId: 5,
    interviewType: "综合面",
    difficulty: "中级",
    interviewerStyle: "严谨专业",
    focus: "",
    persona: "",
  };
  return { AUTO_ROUNDS_OPTION: "auto", fixedValues: { ...base, rounds: 6 } };
});

vi.mock("./interview/SetupTab", () => ({
  AUTO_ROUNDS_OPTION: setupStubs.AUTO_ROUNDS_OPTION,
  SetupTab: ({ onStart }: { onStart: (values: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onStart(setupStubs.fixedValues)}>
      start-stub
    </button>
  ),
}));

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
        content: "Q1",
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

/**
 * 按可访问名做"包含"匹配。
 *
 * 不用 `new RegExp(t(...))`：语言包里有 `Ctrl+Enter`、括号等正则元字符，拼出来的模式
 * 匹配不到原文（第一版就是这么红的）。也不用精确字符串——antd 的图标会给按钮名贡献
 * 一个 `check-circle`，精确匹配永远不等。
 */
function named(label: string) {
  return (name: string): boolean => name.includes(label);
}

/** 冲掉微任务（mock 的 promise 都立刻 resolve，不需要推进定时器）。 */
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 计时器读数节点（`面试用时 00:00` 由两段文本拼成，用选择器取整块更稳）。 */
function timerNode(): Element | null {
  return document.querySelector(".interview-timer");
}

/** 进房间（点桩按钮 → 等开场请求回包 → 冲掉 effect）。 */
async function enterRoom() {
  await flushPromises();
  await act(async () => {
    fireEvent.click(screen.getByText("start-stub"));
  });
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  // InterviewPage 的新消息滚动 effect 依赖 scrollIntoView，jsdom 未实现。
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  apiMocks.listInterviews.mockReset().mockResolvedValue([]);
  apiMocks.createInterview.mockReset().mockResolvedValue(makeDetail());
  apiMocks.updateInterviewDuration.mockReset().mockResolvedValue({});
  apiMocks.getInterview.mockReset();
  apiMocks.deleteInterview.mockReset().mockResolvedValue(undefined);
  apiMocks.finishInterview.mockReset();
  apiMocks.interviewToMaterial.mockReset();
  streamMocks.consumeSSE.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InterviewPage 计时器与「准备好了」闸门", () => {
  it("进房间先看到闸门，计时器与作答区都不出现", async () => {
    renderPage();
    await enterRoom();

    expect(
      screen.getByRole("button", { name: named(t("interviewPage.ready.start")) }),
    ).toBeTruthy();
    // 点「开始面试」不等于开始计时：读数不许出现，输入框也不许出现。
    expect(timerNode()).toBeNull();
    expect(screen.queryByPlaceholderText(t("interview.placeholder"))).toBeNull();
    // 面试官也还没开口：第一题在点「准备好了」之前不该出现（后端开场时就已经生成好了，
    // 那只是"备着"，用户看到的顺序必须是"我先说我准备好了，他才开始问"）。
    expect(screen.queryByText("Q1")).toBeNull();
  });

  it("点「准备好了」后计时器出现，推进 65s 显示 01:05", async () => {
    renderPage();
    await enterRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: named(t("interviewPage.ready.start")) }));
    });
    await flushPromises();

    expect(timerNode()?.textContent).toContain("00:00");
    // 点了准备好了，面试官才"开口"：第一题这时才出现。
    expect(screen.getByText("Q1")).toBeTruthy();
    // 闸门按钮消失，作答区出现（闸门与输入框互斥）。
    expect(
      screen.queryByRole("button", { name: named(t("interviewPage.ready.start")) }),
    ).toBeNull();
    expect(screen.getByPlaceholderText(t("interview.placeholder"))).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(timerNode()?.textContent).toContain("01:05");
  });

  it("退出房间再进来又回到闸门（离开的那段不算进时长）", async () => {
    renderPage();
    await enterRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: named(t("interviewPage.ready.start")) }));
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(timerNode()?.textContent).toContain("00:10");

    // 「新建」= 离开房间：先上报时长，再回到设定页。
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: named(t("interview.action.new")) }));
    });
    await flushPromises();
    expect(apiMocks.updateInterviewDuration).toHaveBeenCalledWith(7, 10);

    await enterRoom();
    // 重新进房间 == 重新过闸门：读数清空、按钮回到「准备好了」。
    expect(timerNode()).toBeNull();
    expect(
      screen.getByRole("button", { name: named(t("interviewPage.ready.start")) }),
    ).toBeTruthy();
  });

  it("最后一答提交后：气泡说「本场面试结束，正在生成报告」，不再说正在思考下一题", async () => {
    // 固定 6 轮、已答 5 轮 → 这一次就是最后一答。流式请求故意不返回，
    // 好让界面停在"等待"状态上被断言（真实场景等的是报告生成）。
    streamMocks.consumeSSE.mockImplementation(() => new Promise(() => undefined as never));
    apiMocks.createInterview.mockResolvedValue(makeDetail({ answered_rounds: 5 }));

    renderPage();
    await enterRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: named(t("interviewPage.ready.start")) }));
    });
    await flushPromises();

    const textarea = screen.getByPlaceholderText(t("interview.placeholder"));
    fireEvent.change(textarea, { target: { value: "这是我的最后一答" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: named(t("interview.action.submit")) }));
    });
    await flushPromises();

    expect(screen.getByText(t("interviewPage.thinkingFinishReport"))).toBeTruthy();
    expect(screen.queryByText(t("interview.thinking"))).toBeNull();
  });
});
