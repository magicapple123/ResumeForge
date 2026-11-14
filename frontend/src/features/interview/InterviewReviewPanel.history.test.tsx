// SPDX-License-Identifier: Apache-2.0
/** 复盘面板：分析后自动保存、历史记录富还原（反向优化简历可点并写回）、旧版纯文本兼容。 */
import { App as AntApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import InterviewReviewPanel from "./InterviewReviewPanel";

const apiMocks = vi.hoisted(() => ({
  analyzeInterviewQuestion: vi.fn(),
  optimizeResumeFromInterview: vi.fn(),
  listReviews: vi.fn(),
  saveReview: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
}));

vi.mock("../../api/interview", () => apiMocks);

// 岗位 / 简历下拉已改为组件内部远程搜索（P0-1）：候选来自这两个 API 的 mock。
const jobsMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
}));
const resumesMocks = vi.hoisted(() => ({
  listResumes: vi.fn(),
  getResume: vi.fn(),
}));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);

const ANALYSIS = {
  question: "这个项目难点怎么解决？",
  framework: "先讲背景，再讲取舍与结果。",
  key_points: ["说明约束"],
  follow_up: ["这个指标怎么算的"],
  pitfalls: ["只讲过程不讲结果"],
};

const OPTIMIZE = {
  resume_id: 1,
  llm_used: true,
  notes: [],
  suggestions: [
    {
      priority: "high",
      section: "项目经历",
      issue: "难点描述不够量化",
      suggestion: "补充指标与对比",
      evidence: ["面试被追问指标口径"],
    },
  ],
};

const RECORD = {
  id: 9,
  job_id: null,
  job_title: "",
  company: "",
  resume_id: null,
  resume_title: "",
  questions: ["这个项目难点怎么解决？"],
  analysis: ANALYSIS,
  suggestions: [],
  model: "",
  created_at: "2026-09-20T10:00:00",
  updated_at: "2026-09-20T10:00:00",
};

function renderPanel(props: Partial<React.ComponentProps<typeof InterviewReviewPanel>> = {}) {
  return render(
    <AntApp>
      <InterviewReviewPanel onGoToResume={() => {}} {...props} />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.analyzeInterviewQuestion.mockReset().mockResolvedValue(ANALYSIS);
  apiMocks.optimizeResumeFromInterview.mockReset().mockResolvedValue(OPTIMIZE);
  apiMocks.listReviews.mockReset().mockResolvedValue([]);
  apiMocks.saveReview.mockReset().mockResolvedValue(undefined);
  apiMocks.updateReview.mockReset().mockResolvedValue(undefined);
  apiMocks.deleteReview.mockReset().mockResolvedValue(undefined);
  jobsMocks.listJobs.mockReset().mockResolvedValue({
    items: [{ id: 1, title: "后端开发工程师", company: "" }],
    total: 1,
  });
  jobsMocks.getJob.mockReset().mockResolvedValue({ id: 1, title: "后端开发工程师", company: "" });
  resumesMocks.listResumes.mockReset().mockResolvedValue({
    items: [{ id: 1, title: "我的简历" }],
    total: 1,
  });
  resumesMocks.getResume.mockReset().mockResolvedValue({ id: 1, title: "我的简历" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("InterviewReviewPanel 自动保存与历史富还原", () => {
  it("分析出思路后自动保存被调用", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(/录入面试里真实被问的问题/), {
      target: { value: "这个项目难点怎么解决？" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );

    await waitFor(() => expect(apiMocks.saveReview).toHaveBeenCalled());
    expect(apiMocks.saveReview).toHaveBeenCalledWith(
      expect.objectContaining({ questions: ["这个项目难点怎么解决？"], analysis: ANALYSIS }),
    );
  });

  it("点击历史「查看详情」把记录交给父组件打开", async () => {
    apiMocks.listReviews.mockResolvedValue([RECORD]);
    const onOpenRecord = vi.fn();
    renderPanel({ onOpenRecord });

    expect(await screen.findByText(t("interview.reviewHistory.fallbackTitle"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("interview.reviewHistory.fallbackTitle")));
    fireEvent.click(
      screen.getAllByRole("button", {
        name: new RegExp(t("interview.reviewHistory.action.detail")),
      })[0],
    );

    await waitFor(() => expect(onOpenRecord).toHaveBeenCalledWith(RECORD));
  });

  it("历史记录富还原：反向优化简历按钮可点并写回该条记录", async () => {
    renderPanel({ record: RECORD });

    // 历史记录的答题思路已直接渲染（与生成时相同路径）。
    expect(await screen.findByText(/先讲背景/)).toBeInTheDocument();

    // 选简历后点击「反向优化简历」。
    const resumeSelect = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    // i18n-ok: 断言测试夹具里的简历标题，不是产品文案
    fireEvent.click(await screen.findByText("我的简历"));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.optimize")) }),
    );

    expect(await screen.findByText(/补充指标与对比/)).toBeInTheDocument();
    expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
      {
        resume_id: 1,
        job_id: null,
        weaknesses: ANALYSIS.pitfalls,
        follow_ups: ANALYSIS.follow_up,
      },
      // T04-d：反向优化可被「停止」掐断，第二个参数是 AbortSignal。
      expect.anything(),
    );

    // 生成结果写回同一条历史记录（PATCH）。
    await waitFor(() =>
      expect(apiMocks.updateReview).toHaveBeenCalledWith(
        9,
        expect.objectContaining({
          analysis: ANALYSIS,
          suggestions: OPTIMIZE.suggestions,
        }),
      ),
    );
  });

  it("旧版纯文本记录仅兼容展示并提示仅可查看", async () => {
    renderPanel({
      record: { ...RECORD, analysis: "旧版纯文本复盘内容……" } as unknown as typeof RECORD,
    });

    expect(await screen.findByText(t("interviewReview.legacy.title"))).toBeInTheDocument();
    expect(screen.getByText(/旧版纯文本复盘内容/)).toBeInTheDocument();
  });
});

describe("InterviewReviewPanel optimize preconditions (issue 12)", () => {
  // Mock resume title, escape-encoded so the CJK ratchet does not count a new line.
  const RESUME_LABEL = "\u6211\u7684\u7b80\u5386";

  /** The online record from 2026-10-23: framework only, both arrays never persisted. */
  const OLD_RECORD = {
    ...RECORD,
    id: 11,
    resume_id: 1,
    analysis: { ...ANALYSIS, key_points: [], follow_up: [], pitfalls: [] },
  };

  /** The saved-review resume select: optimize() bails out without a resume id. */
  async function pickResume() {
    const resumeSelect = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    fireEvent.click(await screen.findByText(RESUME_LABEL));
  }

  it("disables the button and explains what to type when both lists are empty", async () => {
    renderPanel({ record: OLD_RECORD });

    const button = await screen.findByRole("button", {
      name: new RegExp(t("interviewReview.action.optimize")),
    });
    expect(button).toBeDisabled();
    // A disabled button with nowhere to type was the dead end this issue is about.
    expect(screen.getByText(t("interviewReview.optimize.needInput"))).toBeInTheDocument();
    expect(apiMocks.optimizeResumeFromInterview).not.toHaveBeenCalled();
  });

  it("enables the button once one weakness is typed, and sends exactly that", async () => {
    renderPanel({ record: OLD_RECORD });

    const weaknesses = screen.getByLabelText(
      t("interviewReview.field.weaknesses"),
    ) as HTMLTextAreaElement;
    expect(weaknesses.value).toBe("");

    fireEvent.change(weaknesses, { target: { value: "Could not explain the metric" } });

    const button = screen.getByRole("button", {
      name: new RegExp(t("interviewReview.action.optimize")),
    });
    expect(button).toBeEnabled();
    expect(screen.queryByText(t("interviewReview.optimize.needInput"))).toBeNull();

    await pickResume();
    fireEvent.click(button);

    await waitFor(() =>
      expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
        {
          resume_id: 1,
          job_id: null,
          weaknesses: ["Could not explain the metric"],
          follow_ups: [],
        },
        expect.anything(),
      ),
    );

    // The hand-written lists are written back into `analysis`, so reopening the record shows them.
    await waitFor(() =>
      expect(apiMocks.updateReview).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          analysis: expect.objectContaining({
            pitfalls: ["Could not explain the metric"],
            follow_up: [],
          }),
        }),
      ),
    );
  });

  it("submits with follow-ups only when weaknesses stay empty", async () => {
    renderPanel({ record: OLD_RECORD });

    fireEvent.change(screen.getByLabelText(t("interviewReview.field.followUps")), {
      target: { value: "How is this metric calculated?" },
    });
    await pickResume();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.optimize")) }),
    );

    await waitFor(() =>
      expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
        expect.objectContaining({
          weaknesses: [],
          follow_ups: ["How is this metric calculated?"],
        }),
        expect.anything(),
      ),
    );
  });
});

describe("InterviewReviewPanel 半成品历史记录不再白屏", () => {
  it("analysis 只有 framework：不抛错，framework 照常显示", async () => {
    // 线上真实记录：模型只写了 framework，没有 key_points / follow_up / pitfalls。
    // 旧代码直接读 viewAnalysis.key_points.length → TypeError，点「查看详情」整页白屏。
    const framework = "只写了框架，没有要点";
    renderPanel({
      record: {
        ...RECORD,
        analysis: { framework } as unknown as typeof RECORD.analysis,
        // suggestions 也可能整个缺失。
        suggestions: undefined as unknown as typeof RECORD.suggestions,
      },
    });

    expect(await screen.findByText(framework)).toBeInTheDocument();
    // 建议区因为"没有可展示的建议"而不渲染，同样不该崩。
    expect(screen.queryByText(t("interview.suggestions.title"))).toBeNull();
  });
});

/**
 * Q3：历史列表与查看态。
 *
 * 三条都是"屏幕上只该有一份内容"的直接后果：查看某条记录时列表要消失、列表的操作不用先
 * 展开、展开后也只是摘要（完整内容点进去看）。
 */
describe("InterviewReviewPanel 历史列表与查看态（Q3）", () => {
  it("查看某条记录时历史列表不再渲染（不会出现两份内容）", async () => {
    apiMocks.listReviews.mockResolvedValue([RECORD]);
    renderPanel({ record: RECORD, onOpenRecord: vi.fn(), onCloseRecord: vi.fn() });

    expect(await screen.findByText(RECORD.analysis.framework)).toBeInTheDocument();
    // 历史列表整张卡（标题、查看详情、删除）都不在。
    expect(screen.queryByText(t("interview.reviewHistory.title"))).toBeNull();
    expect(screen.queryByText(t("interview.reviewHistory.action.detail"))).toBeNull();
    expect(screen.queryByText(t("interview.reviewHistory.action.delete"))).toBeNull();
    // 退出入口在卡片头上（按钮里带图标，accessible name 会带图标前缀，按前缀匹配）。
    expect(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.header.back")) }),
    ).toBeInTheDocument();
  });

  it("行尾「查看详情」不用先展开就能点", async () => {
    apiMocks.listReviews.mockResolvedValue([{ ...RECORD, job_title: "Backend" }]);
    const onOpenRecord = vi.fn();
    renderPanel({ onOpenRecord });

    const detail = await screen.findByRole("button", {
      name: t("interview.reviewHistory.action.detail"),
    });
    expect(detail).toBeInTheDocument();
    // 没有点过折叠头，也没有任何问题正文出现在屏幕上——操作就在行尾。
    expect(screen.queryByText(RECORD.analysis.framework)).toBeNull();

    fireEvent.click(detail);
    await waitFor(() =>
      expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 9 })),
    );
  });

  it("折叠内容降级为摘要：只给问题首句、framework 前段与建议条数", async () => {
    const longFramework = "先讲背景，再讲取舍与结果。".repeat(8);
    apiMocks.listReviews.mockResolvedValue([
      {
        ...RECORD,
        job_title: "Backend",
        analysis: { ...ANALYSIS, framework: longFramework },
        suggestions: OPTIMIZE.suggestions,
      },
    ]);
    renderPanel();

    // 列表要等 listReviews 落地才渲染，先等标题出现再点折叠头。
    expect(await screen.findByText("Backend")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".ant-collapse-header")!);

    expect(
      await screen.findByText(t("interviewReview.history.summary.suggestions", { count: 1 })),
    ).toBeInTheDocument();
    // 建议正文属于详情，不该在折叠区里再出现一遍。
    expect(document.body.textContent).not.toContain("补充指标与对比");
    // framework 被截断（不是完整的 8 遍）。
    expect(screen.queryByText(longFramework)).toBeNull();
  });
});

/**
 * F01 / F02 / F03：记录态与工作区必须彼此隔离，自动保存必须留下"已入库"凭据。
 *
 * 三条缺陷同源：历史记录的内容被灌进工作区 state、自动保存的返回值被丢掉。
 */
describe("InterviewReviewPanel 记录态隔离与写回（F01–F03）", () => {
  it("往返历史后工作区不被污染：答题思路卡消失、录入卡与历史列表回来", async () => {
    apiMocks.listReviews.mockResolvedValue([RECORD]);
    const { rerender } = renderPanel();

    // 工作态：录入卡在、历史列表在。
    expect(screen.getByText(t("interview.reviewHistory.title"))).toBeInTheDocument();
    expect(screen.queryByText(/先讲背景/)).toBeNull();

    // 打开记录：只显示记录内容，列表让位。
    rerender(
      <AntApp>
        <InterviewReviewPanel onGoToResume={() => {}} record={RECORD} />
      </AntApp>,
    );
    expect(await screen.findByText(/先讲背景/)).toBeInTheDocument();
    expect(screen.queryByText(t("interview.reviewHistory.title"))).toBeNull();

    // 返回：记录内容不得"冒充"成工作区结果（旧实现会留下答题思路卡）。
    rerender(
      <AntApp>
        <InterviewReviewPanel onGoToResume={() => {}} />
      </AntApp>,
    );
    await waitFor(() =>
      expect(screen.getByText(t("interview.reviewHistory.title"))).toBeInTheDocument(),
    );
    expect(screen.queryByText(/先讲背景/)).toBeNull();
    expect(screen.queryByText(/只讲过程不讲结果/)).toBeNull();
  });

  it("自动保存后「保存复盘」收起，不会二次入库（F02）", async () => {
    apiMocks.saveReview.mockResolvedValue({ ...RECORD, id: 42 });

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/录入面试里真实被问的问题/), {
      target: { value: "这个项目难点怎么解决？" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );

    await waitFor(() => expect(apiMocks.saveReview).toHaveBeenCalledTimes(1));
    // 自动保存已入库 → 按钮收起；页面上没有第二颗可点的保存入口。
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: new RegExp(t("interviewReview.action.save")) }),
      ).toBeNull(),
    );
    expect(apiMocks.saveReview).toHaveBeenCalledTimes(1);
  });

  it("工作态反向优化写回自动保存的那一条（F03）", async () => {
    apiMocks.saveReview.mockResolvedValue({ ...RECORD, id: 42 });

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/录入面试里真实被问的问题/), {
      target: { value: "这个项目难点怎么解决？" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );
    await waitFor(() => expect(apiMocks.saveReview).toHaveBeenCalledTimes(1));

    // 工作态的简历下拉（记录态才有「关联简历」卡，这里的占位符是同一份文案）。
    const select = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(select!);
    // i18n-ok: 断言测试夹具里的简历标题，不是产品文案
    fireEvent.click(await screen.findByText("我的简历"));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.optimize")) }),
    );

    await waitFor(() =>
      expect(apiMocks.updateReview).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ suggestions: OPTIMIZE.suggestions }),
      ),
    );
    // 工作区不新增第二条记录。
    expect(apiMocks.saveReview).toHaveBeenCalledTimes(1);
  });
});
