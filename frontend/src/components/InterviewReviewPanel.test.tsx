// SPDX-License-Identifier: Apache-2.0
/** 面试复盘面板：录入问题 → 分析答题思路 → 反向优化建议渲染。 */
import { App as AntApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InterviewReviewPanel from "./InterviewReviewPanel";

const apiMocks = vi.hoisted(() => ({
  analyzeInterviewQuestion: vi.fn(),
  optimizeResumeFromInterview: vi.fn(),
  listReviews: vi.fn(),
  saveReview: vi.fn(),
  deleteReview: vi.fn(),
}));

vi.mock("../api/interview", () => apiMocks);

// 岗位 / 简历下拉已改为组件内部远程搜索（P0-1）：候选来自这两个 API 的 mock。
const jobsMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
}));
const resumesMocks = vi.hoisted(() => ({
  listResumes: vi.fn(),
  getResume: vi.fn(),
}));

vi.mock("../api/jobs", () => jobsMocks);
vi.mock("../api/resumes", () => resumesMocks);

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
});
