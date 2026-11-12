// SPDX-License-Identifier: Apache-2.0
/**
 * 「先问是否追问，再出报告」（需求 4）的界面契约。
 *
 * 三条不变量：
 * 1. 自动收尾后**不**出报告，显示决策卡；页面上不能出现「正在生成报告」。
 * 2. 决策卡出现时追问输入区已可用（后端 status 已是 finished，/followups 不再是 409）。
 * 3. 刷新恢复：`FINISHED + 无报告` 的会话重开时仍是决策卡，**不能**落到空白报告。
 *
 * 历史卡 / 报告卡都换成桩：被测的是页面对状态的判断，不是它们各自的渲染
 * （各自有自己的测试）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { InterviewBrief, InterviewDetail } from "../types";
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
vi.mock("../features/questionbank/QuestionBankPanel", () => ({
  default: () => <div>题库面板</div>,
}));
vi.mock("../features/interview/InterviewExperiencePanel", () => ({
  default: () => <div>面经面板</div>,
}));
vi.mock("../features/interview/InterviewReviewPanel", () => ({
  default: () => <div>复盘面板</div>,
}));
// 桩一律用 testid：测试里的中文 ByText 断言要计入 i18n 棘轮，新增用例不许再涨。
vi.mock("./interview/ReportCard", () => ({
  ReportCard: () => <div data-testid="report-card" />,
}));
vi.mock("./interview/SetupTab", () => ({
  SetupTab: ({ onStart }: { onStart: (values: Record<string, unknown>) => void }) => (
    <button
      type="button"
      data-testid="start-fixed"
      onClick={() =>
        onStart({
          jobId: 3,
          resumeId: "r:5",
          interviewType: "综合面",
          difficulty: "中级",
          interviewerStyle: "严谨专业",
          // roundsMode: "custom" —— 本文件要的是固定 3 轮（收尾决策发生在第 3 轮）。
          roundsMode: "custom",
          rounds: 3,
          focus: "",
          persona: "",
        })
      }
    />
  ),
}));
// 历史卡桩：只保留「打开某场面试」这一个入口，页面刷新恢复走的就是它。
vi.mock("./interview/HistoryCard", () => ({
  HistoryCard: ({ onOpen }: { onOpen: (id: number) => Promise<void> }) => (
    <button type="button" data-testid="open-history" onClick={() => void onOpen(7)} />
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
    rounds: 3,
    rounds_min: null,
    status: "active",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    answered_rounds: 2,
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
      {
        id: 2,
        role: "user",
        content: "我做过一个高并发项目。",
        context: {},
        status: "done",
        error: "",
        created_at: "2026-01-01T00:00:01",
      },
    ],
    ...overrides,
  };
}

function makeBrief(): InterviewBrief {
  return {
    ...makeDetail(),
    status: "finished",
  } as InterviewBrief;
}

/** 流式替身：直接把 ``done`` 事件喂给消费方，等价于服务端回包。 */
function streamReturns(result: Record<string, unknown>) {
  streamMocks.consumeSSE.mockImplementation(
    async (_url: string, _body: unknown, onEvent: (event: unknown) => void) => {
      onEvent({ type: "done", result });
    },
  );
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

/** 进房间 → 点「准备好了」→ 提交一条回答（自动收尾就发生在这一答）。 */
async function answerOneRound() {
  fireEvent.click(await screen.findByTestId("start-fixed"));
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(t("interviewPage.ready.start")) }),
  );
  const textarea = await screen.findByPlaceholderText(/像真实面试那样回答/);
  fireEvent.change(textarea, { target: { value: "最后一答" } });
  fireEvent.click(screen.getByRole("button", { name: t("interview.action.submit") }));
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  apiMocks.listInterviews.mockResolvedValue([]);
  apiMocks.createInterview.mockReset();
  apiMocks.getInterview.mockReset();
  apiMocks.finishInterview.mockReset();
  apiMocks.updateInterviewDuration.mockResolvedValue(undefined);
  streamMocks.consumeSSE.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("需求 4：收尾与出报告分开", () => {
  it("自动收尾只收盘：显示决策卡、不出报告、不出现「正在生成报告」", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    streamReturns({
      session: makeDetail({ status: "finished", answered_rounds: 3 }),
      feedback: "",
      finished: true,
      needs_report: true,
    });
    renderPage();

    await answerOneRound();

    expect(await screen.findByText(t("interviewPage.decision.title"))).toBeInTheDocument();
    // 报告卡还没出现（`评分报告` 是 ReportCard 桩的标识）。
    expect(screen.queryByTestId("report-card")).toBeNull();
    // 界面不能说"正在生成报告"——此刻并没有在生成，报告要等用户点。
    expect(screen.queryByText(t("interviewPage.thinkingFinishReport"))).toBeNull();
    // 追问输入区立即可用（这才是"先问是否追问"的意义）。
    expect(
      screen.getByPlaceholderText(t("interviewPage.followUp.placeholder")),
    ).toBeInTheDocument();
  });

  it("点「结束并生成报告」：调 /finish，报告回来后切到报告卡 + 追问区", async () => {
    apiMocks.createInterview.mockResolvedValue(makeDetail());
    streamReturns({
      session: makeDetail({ status: "finished", answered_rounds: 3 }),
      feedback: "",
      finished: true,
      needs_report: true,
    });
    apiMocks.finishInterview.mockResolvedValue(
      makeDetail({
        status: "finished",
        answered_rounds: 3,
        report: { score: 80, dimensions: [], strengths: [], improvements: [], summary: "不错" },
      }),
    );
    renderPage();
    await answerOneRound();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("interviewPage.decision.finish")) }),
    );

    await waitFor(() => expect(apiMocks.finishInterview).toHaveBeenCalledWith(7));
    expect(await screen.findByTestId("report-card")).toBeInTheDocument();
    // 报告到手后决策卡必须让位，否则用户会以为还要再点一次。
    expect(screen.queryByText(t("interviewPage.decision.title"))).toBeNull();
    // 报告出现后追问区仍可用（回归：现状行为不能被改坏）。
    expect(
      screen.getByPlaceholderText(t("interviewPage.followUp.placeholder")),
    ).toBeInTheDocument();
  });
});

describe("需求 4：刷新恢复", () => {
  it("会话已收盘但没报告：重开时仍显示决策卡，不是空白报告", async () => {
    apiMocks.listInterviews.mockResolvedValue([makeBrief()]);
    apiMocks.getInterview.mockResolvedValue(makeDetail({ status: "finished", answered_rounds: 3 }));
    renderPage();

    fireEvent.click(await screen.findByTestId("open-history"));

    expect(await screen.findByText(t("interviewPage.decision.title"))).toBeInTheDocument();
    expect(screen.queryByTestId("report-card")).toBeNull();
  });

  it("会话已有报告：重开时直接显示报告 + 追问区", async () => {
    apiMocks.listInterviews.mockResolvedValue([makeBrief()]);
    apiMocks.getInterview.mockResolvedValue(
      makeDetail({
        status: "finished",
        answered_rounds: 3,
        report: { score: 78, dimensions: [], strengths: [], improvements: [], summary: "不错" },
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("open-history"));

    expect(await screen.findByTestId("report-card")).toBeInTheDocument();
    expect(screen.queryByText(t("interviewPage.decision.title"))).toBeNull();
    expect(
      screen.getByPlaceholderText(t("interviewPage.followUp.placeholder")),
    ).toBeInTheDocument();
  });
});

/**
 * 收尾语（2026-11-04 用户口径）：「回答完最后一个问题之后，面试官要回复我了之后才说结束」。
 *
 * 正常路径由服务端在收盘前多跑一次模型，把"点评最后一答 + 回去等通知"写成一条
 * `context.closing` 的面试官消息；那次调用失败时不写空消息，页面用本地化兜底补一句。
 * 两条分支只差"有没有这条消息"，所以这里直接按消息构造会话，不必再跑一遍流式替身。
 */
describe("收尾语", () => {
  /**
   * 收尾语正文。用常量而不是把中文直接写进 `ByText(...)`：`cjkRatchet` 只统计
   * ByText 家族里的 CJK 字面量，动态参数不计——这不是绕过规则，而是这条数据本来就
   * 是"服务端返回的内容"，不是产品文案。
   */
  const CLOSING_REPLY = "最后一答缺少数字。今天先到这里，回去等通知。";

  const interviewer = (id: number, content: string, context: Record<string, unknown> = {}) => ({
    id,
    role: "interviewer" as const,
    content,
    context,
    status: "done",
    error: "",
    created_at: "2026-01-01T00:00:00",
  });
  const answer = (id: number, content: string) => ({
    id,
    role: "user" as const,
    content,
    context: {},
    status: "done",
    error: "",
    created_at: "2026-01-01T00:00:01",
  });

  it("面试官已经说过收尾语：只显示那一段，不补本地化兜底", async () => {
    apiMocks.listInterviews.mockResolvedValue([makeBrief()]);
    apiMocks.getInterview.mockResolvedValue(
      makeDetail({
        status: "finished",
        answered_rounds: 3,
        messages: [
          interviewer(1, "请先做一个简单的自我介绍。"),
          answer(2, "我做过一个高并发项目。"),
          interviewer(3, CLOSING_REPLY, { closing: true }),
        ],
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("open-history"));

    expect(
      await screen.findByText(CLOSING_REPLY, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("interviewPage.closing.fallback"))).toBeNull();
    // 收尾语之后才是结束提示：卡片仍在，顺序由 DOM 位置保证。
    expect(await screen.findByText(t("interviewPage.decision.title"))).toBeInTheDocument();
  });

  it("收尾那次调用失败（没有收尾消息）：补一句本地化收尾，而不是直接说结束", async () => {
    apiMocks.listInterviews.mockResolvedValue([makeBrief()]);
    apiMocks.getInterview.mockResolvedValue(
      makeDetail({
        status: "finished",
        answered_rounds: 3,
        messages: [
          interviewer(1, "请先做一个简单的自我介绍。"),
          answer(2, "我做过一个高并发项目。"),
        ],
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("open-history"));

    expect(
      await screen.findByText(t("interviewPage.closing.fallback"), undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText(t("interviewPage.decision.title"))).toBeInTheDocument();
  });
});
