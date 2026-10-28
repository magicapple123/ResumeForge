// SPDX-License-Identifier: Apache-2.0
/** 题库面板：生成后自动保存、历史记录富还原（参考答案可点并写回）、旧版纯文本兼容。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewAnswerReview } from "../types";
import QuestionBankPanel from "./QuestionBankPanel";

const apiMocks = vi.hoisted(() => ({
  generateQuestionBank: vi.fn(),
  generateQuestionAnswer: vi.fn(),
  listQuestionBanks: vi.fn(),
  saveQuestionBank: vi.fn(),
  updateQuestionBank: vi.fn(),
  deleteQuestionBank: vi.fn(),
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

const RESULT = {
  job_id: 1,
  job_title: "后端开发工程师",
  company: "示例公司",
  resume_id: null,
  llm_used: true,
  notes: [],
  groups: [
    {
      type: "基础题",
      questions: [{ question: "请自我介绍", purpose: "考察表达", answer_hint: "按 STAR 展开" }],
    },
    { type: "项目深挖题", questions: [] },
    { type: "反问HR题", questions: [] },
  ],
};

const RECORD = {
  id: 7,
  job_id: 1,
  job_title: "后端开发工程师",
  company: "示例公司",
  resume_id: null,
  resume_title: "",
  groups: [
    {
      type: "基础题",
      questions: [{ question: "请自我介绍", purpose: "考察表达", answer_hint: "按 STAR 展开" }],
    },
  ],
  model: "",
  created_at: "2026-09-20T10:00:00",
  updated_at: "2026-09-20T10:00:00",
};

const ANSWER = {
  question: "请自我介绍",
  answer: "围绕经历用 STAR 结构讲清背景、任务、行动与结果。",
  key_points: ["先说结论"],
  sample_phrasing: "我在上一份工作里负责……",
};

function renderPanel(props: React.ComponentProps<typeof QuestionBankPanel>) {
  return render(
    <AntdApp>
      <QuestionBankPanel {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.generateQuestionBank.mockReset().mockResolvedValue(RESULT);
  apiMocks.generateQuestionAnswer.mockReset().mockResolvedValue(ANSWER);
  apiMocks.listQuestionBanks.mockReset().mockResolvedValue([]);
  apiMocks.saveQuestionBank.mockReset().mockResolvedValue(undefined);
  apiMocks.updateQuestionBank.mockReset().mockResolvedValue(undefined);
  apiMocks.deleteQuestionBank.mockReset().mockResolvedValue(undefined);
  jobsMocks.listJobs.mockReset().mockResolvedValue({
    items: [{ id: 1, title: "后端开发工程师", company: "" }],
    total: 1,
  });
  jobsMocks.getJob.mockReset().mockResolvedValue({
    id: 1,
    title: "后端开发工程师",
    company: "",
  });
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  resumesMocks.getResume.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("QuestionBankPanel 自动保存与历史富还原", () => {
  it("生成成功后自动保存被调用", async () => {
    renderPanel({});

    const placeholder = screen.getByText("关联岗位（选填，输入关键词搜索）");
    fireEvent.mouseDown(placeholder.closest(".ant-select-content")!);
    fireEvent.click(await screen.findByText("后端开发工程师"));
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));

    await waitFor(() => expect(apiMocks.saveQuestionBank).toHaveBeenCalled());
    expect(apiMocks.saveQuestionBank).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 1, groups: RESULT.groups }),
    );
  });

  it("点击历史「查看详情」把记录交给父组件打开", async () => {
    apiMocks.listQuestionBanks.mockResolvedValue([RECORD]);
    const onOpenRecord = vi.fn();
    renderPanel({ onOpenRecord });

    expect(await screen.findByText("后端开发工程师")).toBeInTheDocument();
    fireEvent.click(screen.getByText("后端开发工程师"));
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));

    await waitFor(() => expect(onOpenRecord).toHaveBeenCalledWith(RECORD));
  });

  it("历史记录富还原：参考答案按钮可点并写回该条记录", async () => {
    renderPanel({ record: RECORD });

    // 渲染用与生成时相同的路径：题目、参考答案按钮都在。
    expect(await screen.findByText(/请自我介绍/)).toBeInTheDocument();

    const answerButtons = screen.getAllByRole("button", { name: /参考答案/ });
    fireEvent.click(answerButtons[0]);

    expect(await screen.findByText(/围绕经历/)).toBeInTheDocument();
    expect(apiMocks.generateQuestionAnswer).toHaveBeenCalledWith(
      {
        question: "请自我介绍",
        job_id: RECORD.job_id ?? null,
        resume_id: RECORD.resume_id ?? null,
      },
      // T04-d：参考答案可被「停止」掐断，第二个参数是 AbortSignal。
      expect.anything(),
    );

    // 生成结果写回同一条历史记录（PATCH）。
    await waitFor(() =>
      expect(apiMocks.updateQuestionBank).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          groups: expect.arrayContaining([
            expect.objectContaining({
              type: "基础题",
              questions: expect.arrayContaining([
                expect.objectContaining({ answer: ANSWER.answer, key_points: ANSWER.key_points }),
              ]),
            }),
          ]),
        }),
      ),
    );
  });

  it("旧版纯文本记录仅兼容展示并提示仅可查看", async () => {
    renderPanel({
      record: { ...RECORD, groups: "旧版纯文本题库内容……" } as unknown as typeof RECORD,
    });

    expect(await screen.findByText("此为旧版记录，仅可查看")).toBeInTheDocument();
    expect(screen.getByText(/旧版纯文本题库内容/)).toBeInTheDocument();
    // 富还原的答案按钮不应出现。
    expect(screen.queryByRole("button", { name: /参考答案/ })).not.toBeInTheDocument();
  });

  it("历史记录里的 review 是空对象时不崩：按「没批改过」处理", async () => {
    // 后端 `InterviewQuestionItem.review` 的默认值就是 `{}`，每道题都会带一个空对象回来。
    // 若把它当成"有批改结果"，打开详情就会去读 `strengths.length` 而整页白屏。
    const recordWithEmptyReview = {
      ...RECORD,
      groups: [
        {
          type: "基础题",
          questions: [
            {
              question: "请自我介绍",
              purpose: "考察表达",
              answer_hint: "按 STAR 展开",
              my_answer: "",
              // 后端就是这么返回的（空对象），所以这里刻意照抄，不加类型上的美化。
              review: {} as InterviewAnswerReview,
            },
          ],
        },
      ],
    };
    renderPanel({ record: recordWithEmptyReview });

    await waitFor(() => expect(document.querySelector(".question-bank-question")).not.toBeNull());
    // 没有批改结果 → 不该出现分数环与三段清单。
    expect(document.querySelector(".answer-review-view")).toBeNull();
  });
});
