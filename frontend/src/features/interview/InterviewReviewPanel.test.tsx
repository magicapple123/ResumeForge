// SPDX-License-Identifier: Apache-2.0
/** 面试复盘面板：录入问题 → 分析答题思路 → 反向优化建议渲染。 */
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
  deleteReview: vi.fn(),
  // 复盘支持「上传文件」（Q3）：解析结果由用例决定，组件只负责把文本交给提交载荷。
  extractInterviewMaterial: vi.fn(),
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
// 复盘支持外部简历（Q3）：下拉里的「外部简历」分组走这两个接口。
const externalResumeMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  getExternalResume: vi.fn(),
}));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);
vi.mock("../../api/externalResumes", () => externalResumeMocks);

const ANALYSIS = {
  question: "这个项目难点怎么解决？",
  framework: "先讲背景，再讲取舍与结果。",
  key_points: ["说明约束", "给出量化结果"],
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

/** Mock resume title, escape-encoded so the CJK ratchet does not count a new line. */
const RESUME_LABEL = "\u6211\u7684\u7b80\u5386";

/** 外部简历的正文与文件名（Q3）：没有内部 id，正文只能随请求带上去。 */
const EXTERNAL_TEXT = "External resume body";
const EXTERNAL_ITEM = {
  id: 7,
  file_id: 70,
  name: "external-a.pdf",
  mime: "application/pdf",
  text_chars: EXTERNAL_TEXT.length,
  has_text: true,
  job_id: null,
  job_title: "",
  created_at: "2026-11-11T00:00:00",
  updated_at: "2026-11-11T00:00:00",
  warnings: [],
};

function renderPanel() {
  return render(
    <AntApp>
      <InterviewReviewPanel onGoToResume={() => {}} />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.analyzeInterviewQuestion.mockReset().mockResolvedValue(ANALYSIS);
  apiMocks.optimizeResumeFromInterview.mockReset().mockResolvedValue(OPTIMIZE);
  apiMocks.listReviews.mockReset().mockResolvedValue([]);
  apiMocks.saveReview.mockReset();
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
  externalResumeMocks.listExternalResumes.mockReset().mockResolvedValue({
    items: [EXTERNAL_ITEM],
    total: 1,
    page: 1,
    page_size: 50,
  });
  externalResumeMocks.getExternalResume
    .mockReset()
    .mockResolvedValue({ ...EXTERNAL_ITEM, text: EXTERNAL_TEXT });
  apiMocks.extractInterviewMaterial.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("InterviewReviewPanel", () => {
  it("录入问题后分析答题思路，并展示框架与要点", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(/录入面试里真实被问的问题/), {
      target: { value: "这个项目难点怎么解决？" },
    });
    fireEvent.click(screen.getByRole("button", { name: /分析答题思路/ }));

    expect(await screen.findByText(/先讲背景/)).toBeInTheDocument();
    expect(screen.getByText("说明约束")).toBeInTheDocument();
    expect(apiMocks.analyzeInterviewQuestion).toHaveBeenCalledWith(
      {
        question: "这个项目难点怎么解决？",
        job_id: null,
        resume_id: null,
      },
      // T04-d：分析可被「停止」掐断，第二个参数是 AbortSignal。
      expect.anything(),
    );
  });

  it("反向优化简历产出并渲染建议列表", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(/录入面试里真实被问的问题/), {
      target: { value: "这个项目难点怎么解决？" },
    });
    fireEvent.click(screen.getByRole("button", { name: /分析答题思路/ }));
    await screen.findByText(/先讲背景/);

    // 反向优化需要先选简历。
    fireEvent.click(screen.getByRole("button", { name: /反向优化简历/ }));
    expect(await screen.findByText(/请先选择要优化的简历/)).toBeInTheDocument();

    // 选简历后再次点击：产出建议列表。
    const resumeSelect = screen
      .getByText("关联简历（反向优化必选，输入关键词搜索）")
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    fireEvent.click(await screen.findByText("我的简历"));

    fireEvent.click(screen.getByRole("button", { name: /反向优化简历/ }));
    expect(await screen.findByText(/补充指标与对比/)).toBeInTheDocument();
    expect(screen.getByText("项目经历")).toBeInTheDocument();

    await waitFor(() =>
      expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
        {
          resume_id: 1,
          job_id: null,
          weaknesses: ["只讲过程不讲结果"],
          follow_ups: ["这个指标怎么算的"],
        },
        // T04-d：反向优化可被「停止」掐断，第二个参数是 AbortSignal。
        expect.anything(),
      ),
    );
  });

  it("分析出思路后「保存复盘」把问题与思路落成历史", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(/录入面试里真实被问的问题/), {
      target: { value: "这个项目难点怎么解决？" },
    });
    fireEvent.click(screen.getByRole("button", { name: /分析答题思路/ }));
    await screen.findByText(/先讲背景/);

    fireEvent.click(screen.getByRole("button", { name: /保存复盘/ }));

    await waitFor(() =>
      expect(apiMocks.saveReview).toHaveBeenCalledWith({
        job_id: null,
        job_title: "",
        company: "",
        resume_id: null,
        resume_title: "",
        questions: ["这个项目难点怎么解决？"],
        analysis: ANALYSIS,
        suggestions: [],
        model: "",
      }),
    );
  });

  it("「历史复盘」回看某次复盘并可删除", async () => {
    apiMocks.listReviews.mockResolvedValue([
      {
        id: 1,
        job_id: null,
        job_title: "后端开发工程师",
        company: "示例公司",
        resume_id: null,
        resume_title: "",
        questions: ["这个项目难点怎么解决？"],
        analysis: ANALYSIS,
        suggestions: OPTIMIZE.suggestions,
        model: "",
        created_at: "2026-09-20T10:00:00",
        updated_at: "2026-09-20T10:00:00",
      },
    ]);
    renderPanel();

    expect(await screen.findByText("后端开发工程师")).toBeInTheDocument();

    fireEvent.click(screen.getByText("后端开发工程师"));
    expect(await screen.findByText("这个项目难点怎么解决？")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除复盘历史"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteReview).toHaveBeenCalledWith(1));
  });

  it("prefills both inputs from the model analysis", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(t("interviewReview.placeholder.question")), {
      target: { value: "How did you solve the hard part?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );
    await screen.findByText(ANALYSIS.framework);

    // A review the model already produced weaknesses/follow-ups for needs no retyping.
    expect(
      (screen.getByLabelText(t("interviewReview.field.weaknesses")) as HTMLTextAreaElement).value,
    ).toBe(ANALYSIS.pitfalls[0]);
    expect(
      (screen.getByLabelText(t("interviewReview.field.followUps")) as HTMLTextAreaElement).value,
    ).toBe(ANALYSIS.follow_up[0]);
  });

  it("keeps the model weaknesses when only the follow-ups are edited", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(t("interviewReview.placeholder.question")), {
      target: { value: "How did you solve the hard part?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );
    await screen.findByText(ANALYSIS.framework);

    fireEvent.change(screen.getByLabelText(t("interviewReview.field.followUps")), {
      target: { value: "Why not a message queue?" },
    });

    const resumeSelect = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    fireEvent.click(await screen.findByText(RESUME_LABEL));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.optimize")) }),
    );

    await waitFor(() =>
      expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
        {
          resume_id: 1,
          job_id: null,
          // Weaknesses untouched -> still the model value; follow-ups are hand-written.
          weaknesses: ANALYSIS.pitfalls,
          follow_ups: ["Why not a message queue?"],
        },
        expect.anything(),
      ),
    );
  });

  it("submits only the first 20 items and shows the truncation hint", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText(t("interviewReview.placeholder.question")), {
      target: { value: "How did you solve the hard part?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );
    await screen.findByText(ANALYSIS.framework);

    const twentyFive = Array.from({ length: 25 }, (_, index) => `weakness ${index + 1}`);
    fireEvent.change(screen.getByLabelText(t("interviewReview.field.weaknesses")), {
      target: { value: twentyFive.join("\n") },
    });

    // The backend caps this at MAX_OPTIMIZE_ITEMS = 20; without trimming the submit would 422.
    expect(
      screen.getByText(t("interviewReview.optimize.truncated", { limit: 20 })),
    ).toBeInTheDocument();

    const resumeSelect = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    fireEvent.click(await screen.findByText(RESUME_LABEL));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.optimize")) }),
    );

    await waitFor(() =>
      expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
        expect.objectContaining({
          weaknesses: twentyFive.slice(0, 20),
        }),
        expect.anything(),
      ),
    );
  });
});

/**
 * Q3：复盘支持**外部简历**与**上传文件**。
 *
 * 这两种来源都没有内部简历 id，正文只能随请求带上去（`resume_text` + `resume_title`），
 * 历史里也写 `resume_id: null`。一条硬约束：没有内部 id 时**不出现**「去简历中心对照
 * 修改」——那份建议指向的简历在简历中心里根本不存在。
 */
describe("InterviewReviewPanel 外部简历与上传文件（Q3）", () => {
  /** 录入问题并分析出思路（这是反向优化的前置）。 */
  async function analyzeFirst() {
    fireEvent.change(screen.getByPlaceholderText(t("interviewReview.placeholder.question")), {
      target: { value: "How did you solve the hard part?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );
    await screen.findByText(ANALYSIS.framework);
  }

  it("选外部简历：分析与反向优化都带 resume_text，且不显示去简历中心", async () => {
    const onGoToResume = vi.fn();
    render(
      <AntApp>
        <InterviewReviewPanel onGoToResume={onGoToResume} />
      </AntApp>,
    );
    await analyzeFirst();

    // 下拉里的外部简历分组（`e:` 前缀）：选中即取正文。
    const resumeSelect = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    fireEvent.click(await screen.findByText("external-a.pdf"));
    await waitFor(() => expect(externalResumeMocks.getExternalResume).toHaveBeenCalledWith(7));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.optimize")) }),
    );

    await waitFor(() =>
      expect(apiMocks.optimizeResumeFromInterview).toHaveBeenCalledWith(
        expect.objectContaining({
          resume_id: null,
          resume_text: EXTERNAL_TEXT,
          resume_title: "external-a.pdf",
        }),
        expect.anything(),
      ),
    );
    // 与内部简历同一套建议渲染，但没有「去简历中心对照修改」这个出口。
    // （用 textContent 断言建议正文：这条断言不该再给 CJK 棘轮加一行。）
    await waitFor(() => expect(document.body.textContent).toContain("补充指标与对比"));
    expect(screen.queryByText(t("interview.suggestions.goToResume"))).toBeNull();
    expect(onGoToResume).not.toHaveBeenCalled();
  });

  it("选外部简历后重新分析：请求带 resume_text 与 resume_title", async () => {
    renderPanel();
    await analyzeFirst();

    const resumeSelect = screen
      .getByText(t("interviewReview.placeholder.resume"))
      .closest(".ant-select-content");
    fireEvent.mouseDown(resumeSelect!);
    fireEvent.click(await screen.findByText("external-a.pdf"));
    await waitFor(() => expect(externalResumeMocks.getExternalResume).toHaveBeenCalledWith(7));

    // 改了问题再分析一次：这次的请求必须带上外部简历的正文。
    fireEvent.change(screen.getByPlaceholderText(t("interviewReview.placeholder.question")), {
      target: { value: "Why did you pick that design?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewReview.action.analyze")) }),
    );

    await waitFor(() =>
      expect(apiMocks.analyzeInterviewQuestion).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resume_id: null,
          resume_text: EXTERNAL_TEXT,
          resume_title: "external-a.pdf",
        }),
        expect.anything(),
      ),
    );
  });

  it("上传简历文件：解析出的正文进 resume_text，标题取文件名", async () => {
    apiMocks.extractInterviewMaterial.mockResolvedValue({
      name: "cv.txt",
      text: "Uploaded resume body",
      warnings: [],
      parser: "text",
    });
    renderPanel();

    fireEvent.click(
      screen.getByRole("radio", { name: t("interviewPage.setup.material.fromFile") }),
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input!, "files", {
      value: [new File(["Uploaded resume body"], "cv.txt", { type: "text/plain" })],
      configurable: true,
    });
    fireEvent.change(input!);
    await waitFor(() => expect(screen.getByText("cv.txt")).toBeInTheDocument());

    await analyzeFirst();

    await waitFor(() =>
      expect(apiMocks.analyzeInterviewQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          resume_id: null,
          resume_text: "Uploaded resume body",
          resume_title: "cv.txt",
        }),
        expect.anything(),
      ),
    );
    // 自动保存的那条历史同样写 resume_id: null + resume_title。
    await waitFor(() =>
      expect(apiMocks.saveReview).toHaveBeenCalledWith(
        expect.objectContaining({ resume_id: null, resume_title: "cv.txt" }),
      ),
    );
  });
});
