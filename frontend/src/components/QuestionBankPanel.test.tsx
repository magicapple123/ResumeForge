// SPDX-License-Identifier: Apache-2.0
/** 个性化题库面板：无选择校验、三类分组渲染、开始模拟面试回传题目。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import QuestionBankPanel from "./QuestionBankPanel";

const apiMocks = vi.hoisted(() => ({
  generateQuestionBank: vi.fn(),
  generateQuestionAnswer: vi.fn(),
  reviewQuestionAnswer: vi.fn(),
  updateQuestionBank: vi.fn(),
  listQuestionBanks: vi.fn(),
  saveQuestionBank: vi.fn(),
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
    {
      type: "项目深挖题",
      questions: [{ question: "交易系统难点", purpose: "考察取舍", answer_hint: "说清个人边界" }],
    },
    {
      type: "反问HR题",
      questions: [{ question: "团队如何协作", purpose: "了解团队", answer_hint: "问成长路径" }],
    },
  ],
};

async function pickJob(optionText: string) {
  const placeholder = screen.getByText("关联岗位（选填，输入关键词搜索）");
  const selector = placeholder.closest(".ant-select-content");
  fireEvent.mouseDown(selector!);
  fireEvent.click(await screen.findByText(optionText));
}

function renderPanel(props: React.ComponentProps<typeof QuestionBankPanel>) {
  return render(
    <AntdApp>
      <QuestionBankPanel {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.generateQuestionBank.mockReset();
  apiMocks.generateQuestionAnswer.mockReset();
  apiMocks.listQuestionBanks.mockReset().mockResolvedValue([]);
  apiMocks.saveQuestionBank.mockReset();
  apiMocks.deleteQuestionBank.mockReset().mockResolvedValue(undefined);
  jobsMocks.listJobs.mockReset().mockResolvedValue({
    items: [{ id: 1, title: "后端开发工程师", company: "" }],
    total: 1,
  });
  jobsMocks.getJob.mockReset().mockResolvedValue({ id: 1, title: "后端开发工程师", company: "" });
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  resumesMocks.getResume.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("QuestionBankPanel", () => {
  it("未选择岗位或简历时给出提示且不请求", async () => {
    renderPanel({});
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));

    expect(await screen.findByText(/请至少选择一个岗位或一份简历/)).toBeInTheDocument();
    expect(apiMocks.generateQuestionBank).not.toHaveBeenCalled();
  });

  it("生成后按三类分组渲染并可回传题目开始模拟面试", async () => {
    apiMocks.generateQuestionBank.mockResolvedValue(RESULT);
    const onStartSession = vi.fn();
    renderPanel({ onStartSession });

    await pickJob("后端开发工程师");
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));

    expect(await screen.findByText("共 3 题")).toBeInTheDocument();
    expect(screen.getByText("基础题")).toBeInTheDocument();
    expect(screen.getByText("项目深挖题")).toBeInTheDocument();
    expect(screen.getByText("反问HR题")).toBeInTheDocument();
    expect(screen.getByText(/请自我介绍/)).toBeInTheDocument();
    expect(apiMocks.generateQuestionBank).toHaveBeenCalledWith(
      { job_id: 1, resume_id: null },
      // T04-d：生成可被「停止」掐断，第二个参数是 AbortSignal。
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: /开始模拟面试/ }));
    expect(onStartSession).toHaveBeenCalledWith(["请自我介绍", "交易系统难点", "团队如何协作"]);
  });

  it("接口报错时透出中文错误", async () => {
    apiMocks.generateQuestionBank.mockRejectedValue(new Error("生成题库失败：模型超时"));
    renderPanel({});

    await pickJob("后端开发工程师");
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));

    expect(await screen.findByText("生成题库失败：模型超时")).toBeInTheDocument();
  });

  it("点「参考答案」展开详细答案与话术，再点收起", async () => {
    apiMocks.generateQuestionBank.mockResolvedValue(RESULT);
    apiMocks.generateQuestionAnswer.mockResolvedValue({
      question: "请自我介绍",
      answer: "围绕过往经历，用 STAR 结构讲清背景、任务、行动与结果。",
      key_points: ["先说结论", "量化结果"],
      sample_phrasing: "我在上一份工作里负责……，最终将耗时缩短了 30%。",
    });
    renderPanel({});

    await pickJob("后端开发工程师");
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));
    await screen.findByText("共 3 题");

    // 还没生成过：按钮必须说「生成参考答案」（用户反馈"查看"会误导）。
    expect(
      screen.getAllByRole("button", {
        // antd 的图标会贡献到可访问名里（"bulb 生成参考答案"），所以按包含匹配。
        name: new RegExp(t("questionBankPanel.action.generateAnswer")),
      }).length,
    ).toBeGreaterThan(0);
    const answerButtons = screen.getAllByRole("button", { name: /参考答案/ });
    fireEvent.click(answerButtons[0]);

    // 参考答案现在是三段式排版：正文 /「答题要点」列表 /「话术参考」独立成块。
    // 断言走容器文本 + `t()` 取标题，不新增中文 ByText（tests 口径的棘轮只降不升）。
    // 先等面板出现（生成是异步的），否则下面读到的还是空容器。
    await screen.findByText(t("questionBankPanel.group.keyPointsTitle"));
    const answerBody = document.querySelector(".question-answer-view")?.textContent ?? "";
    expect(answerBody).toContain("围绕过往经历");
    expect(answerBody).toContain("先说结论");
    expect(answerBody).toContain("量化结果");
    expect(screen.getByText(t("questionBankPanel.group.sampleTitle"))).toBeInTheDocument();
    expect(answerBody).toContain("我在上一份工作里负责");
    expect(apiMocks.generateQuestionAnswer).toHaveBeenCalledWith(
      {
        question: "请自我介绍",
        job_id: 1,
        resume_id: null,
      },
      // T04-d：参考答案可被「停止」掐断，第二个参数是 AbortSignal。
      expect.anything(),
    );

    // antd 6 Button 的 loading 有防抖：loading 变 false 后 spinner 仍会短暂保留，
    // 这段时间内 antd 内部会直接吞掉点击（Button.handleClick 里 innerLoading 时
    // preventDefault + return）。React 19 下渲染落点使下面的立即点击会确定性落进
    // 这个窗口，必须等按钮真正退出 loading 态再点——真实用户在窗口期内同样点不动。
    // 生成完才变成「收起参考答案」。
    const collapseBtn = screen.getByRole("button", {
      name: new RegExp(t("questionBankPanel.action.hideAnswer")),
    });
    await waitFor(() => expect(collapseBtn.querySelector(".ant-btn-loading-icon")).toBeNull());
    fireEvent.click(collapseBtn);
    await waitFor(() => expect(screen.queryByText(/围绕过往经历/)).not.toBeInTheDocument());

    // 收起后按钮变成「查看参考答案」，再点只是重新展开——**不会**再请求一次生成。
    // 三张卡各有自己的按钮，取第一张卡（当前这道题）的那一个。
    const showBtn = screen.getAllByRole("button", { name: /查看参考答案/ })[0];
    fireEvent.click(showBtn);
    expect(await screen.findByText(/围绕过往经历/)).toBeInTheDocument();
    expect(apiMocks.generateQuestionAnswer).toHaveBeenCalledTimes(1);
  });

  it("生成后「保存题库」把分组与快照落成历史", async () => {
    apiMocks.generateQuestionBank.mockResolvedValue(RESULT);
    apiMocks.saveQuestionBank.mockResolvedValue({
      id: 1,
      job_id: 1,
      job_title: "后端开发工程师",
      company: "示例公司",
      resume_id: null,
      resume_title: "",
      groups: RESULT.groups,
      model: "",
      created_at: "2026-09-20T10:00:00",
      updated_at: "2026-09-20T10:00:00",
    });
    renderPanel({});

    await pickJob("后端开发工程师");
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));
    await screen.findByText("共 3 题");

    fireEvent.click(screen.getByRole("button", { name: /保存题库/ }));

    await waitFor(() =>
      expect(apiMocks.saveQuestionBank).toHaveBeenCalledWith({
        job_id: 1,
        job_title: "后端开发工程师",
        company: "示例公司",
        resume_id: null,
        resume_title: "",
        groups: RESULT.groups,
        model: "",
      }),
    );
  });

  it("「历史题库」回看某次生成的分组并可删除", async () => {
    apiMocks.listQuestionBanks.mockResolvedValue([
      {
        id: 1,
        job_id: 1,
        job_title: "后端开发工程师",
        company: "示例公司",
        resume_id: null,
        resume_title: "",
        groups: RESULT.groups,
        model: "",
        created_at: "2026-09-20T10:00:00",
        updated_at: "2026-09-20T10:00:00",
      },
    ]);
    renderPanel({});

    expect(await screen.findByText("后端开发工程师")).toBeInTheDocument();

    // 展开历史条目，回看分组里的题目。
    fireEvent.click(screen.getByText("后端开发工程师"));
    expect(await screen.findByText("请自我介绍")).toBeInTheDocument();

    // 删除收进了「···」菜单：打开菜单 → 点删除 → 确认（无 locale 时确认键是 "OK"）。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteQuestionBank).toHaveBeenCalledWith(1));
  });

  it("写下我的答案后交给 AI 批改：显示分数与建议，并写回题库历史", async () => {
    apiMocks.generateQuestionBank.mockResolvedValue(RESULT);
    apiMocks.saveQuestionBank.mockResolvedValue({
      id: 9,
      job_id: 1,
      job_title: "后端开发工程师",
      company: "示例公司",
      resume_id: null,
      resume_title: "",
      groups: RESULT.groups,
      model: "",
      created_at: "2026-09-20T10:00:00",
      updated_at: "2026-09-20T10:00:00",
    });
    apiMocks.updateQuestionBank.mockResolvedValue({});
    apiMocks.generateQuestionAnswer.mockResolvedValue({
      question: "请自我介绍",
      answer: "（自动补的参考答案）先说结论，再讲项目与结果。",
      key_points: ["先结论"],
      sample_phrasing: "我在上一份工作里负责……",
    });
    apiMocks.reviewQuestionAnswer.mockResolvedValue({
      question: "请自我介绍",
      score: 78,
      summary: "结论清楚，但证据不足。",
      strengths: ["开头先给结论"],
      gaps: ["没有量化结果"],
      suggestions: ["补一个订单量或耗时数字"],
      revised_answer: "我在上一家公司负责订单系统，把下单耗时从 800ms 降到 200ms。",
    });
    renderPanel({});

    await pickJob("后端开发工程师");
    fireEvent.click(screen.getByRole("button", { name: /生成题库/ }));
    await screen.findByText(t("questionBankPanel.summary.total", { count: 3 }));

    // 默认收起，点开才出现输入框。
    fireEvent.click(screen.getAllByRole("button", { name: /先写我的答案/ })[0]);
    const textarea = document.querySelector(".my-answer-body textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "我叫张三，做过订单系统。" } });

    fireEvent.click(screen.getByRole("button", { name: /交给 AI 批改/ }));

    expect(await screen.findByText(t("questionBankPanel.review.tone.fair"))).toBeInTheDocument();
    // 分数按档位显示（78 → 还能更好），三段清单与改写示范都要在。
    const reviewText = document.querySelector(".answer-review-view")?.textContent ?? "";
    expect(reviewText).toContain("结论清楚，但证据不足。");
    expect(reviewText).toContain("没有量化结果");
    expect(reviewText).toContain("补一个订单量或耗时数字");
    expect(screen.getByText(t("questionBankPanel.review.revisedAnswer"))).toBeInTheDocument();

    // 之前没生成过参考答案：批改前会自动补一份，并把它带进批改请求。
    expect(apiMocks.generateQuestionAnswer).toHaveBeenCalledWith(
      {
        question: "请自我介绍",
        job_id: 1,
        resume_id: null,
      },
      expect.anything(),
    );
    expect(apiMocks.reviewQuestionAnswer).toHaveBeenCalledWith(
      {
        question: "请自我介绍",
        my_answer: "我叫张三，做过订单系统。",
        job_id: 1,
        resume_id: null,
        reference_answer: "（自动补的参考答案）先说结论，再讲项目与结果。",
      },
      expect.anything(),
    );
    // 刚生成时自动保存出了记录 9：批改结果要写回它，刷新后还在。
    await waitFor(() => expect(apiMocks.updateQuestionBank).toHaveBeenCalled());
    // 第一次写回是"自动补的参考答案"，第二次才是"作答 + 批改结果"——断言最后一次。
    const calls = apiMocks.updateQuestionBank.mock.calls;
    const [, payload] = calls[calls.length - 1];
    expect(payload.groups[0].questions[0].my_answer).toBe("我叫张三，做过订单系统。");
    expect(payload.groups[0].questions[0].review.score).toBe(78);
  });

  // 标题与查询都走 t()/testid：测试文件里的中文是棘轮存量，新用例不再加中文行。
  it("can be stopped while regenerating: back to clickable, no error, previous bank kept", async () => {
    apiMocks.generateQuestionBank.mockResolvedValueOnce(RESULT);
    apiMocks.saveQuestionBank.mockResolvedValue({ id: 9 });
    renderPanel({});

    await pickJob("后端开发工程师");
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("questionBankPanel.action.generate")),
      }),
    );
    expect(
      await screen.findByText(t("questionBankPanel.summary.total", { count: 3 })),
    ).toBeInTheDocument();

    // 第二次生成挂在那里不回包（真请求在用户点停止之前就是这个样子）。
    apiMocks.generateQuestionBank.mockImplementation(
      (_payload: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("questionBankPanel.action.regenerate")),
      }),
    );

    // 生成中：出现「停止」，且不再是 loading 占位。
    const stop = await screen.findByTestId("abort-request");
    fireEvent.click(stop);

    // 停止后：按钮收起（可再点）、上一次的结果仍在、没有错误提示。
    expect(
      await screen.findByText(t("questionBankPanel.summary.total", { count: 3 })),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("abort-request")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("questionBankPanel.action.regenerate")),
      }),
    ).toBeEnabled();
    expect(screen.queryByText(t("questionBankPanel.error.generate"))).toBeNull();
  });
});
