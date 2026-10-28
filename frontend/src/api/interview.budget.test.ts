// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试的**请求预算**回归。
 *
 * 这些端点都会现场调大模型整段生成（题库 / 答题思路 / 参考答案 / 反向优化 / 开场第一题 /
 * 每轮提问+点评 / 评分报告），10–60s 是常态。`request()` 的默认预算是 15s，忘了显式传
 * `budget: "analysis"` 就会在正常生成中被判超时——用户看到的是一句"请求超时，请重试"，
 * 而模型其实还在正常输出（题库「参考答案」的真实故障就是这样来的）。
 *
 * 这里用替身替换 `./client` 的 `request`，只断言预算这一个维度：真实请求行为由
 * client.test.ts 守着。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "./client";
import {
  analyzeInterviewQuestion,
  createInterview,
  finishInterview,
  generateQuestionAnswer,
  generateQuestionBank,
  optimizeResumeFromInterview,
  submitInterviewAnswer,
} from "./interview";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  request: requestMock,
}));
// 流式那条走 SSE（不限时），这里不需要它的真实实现。
vi.mock("./stream", () => ({ consumeSSE: vi.fn() }));

/** 取第 `index` 次调用传下去的请求选项。 */
function optionsOf(index: number): RequestOptions {
  const call = requestMock.mock.calls[index] as [string, RequestOptions?];
  return call[1] ?? {};
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

describe("面试接口：调用大模型的端点必须走 analysis 预算", () => {
  it("generateQuestionAnswer：参考答案（本次故障的主角）", async () => {
    await generateQuestionAnswer({ question: "讲讲你做过的高并发项目" });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(optionsOf(0).budget).toBe("analysis");
    expect(String(requestMock.mock.calls[0][0])).toBe("/interview/questions/answer");
  });

  it("generateQuestionBank：个性化题库", async () => {
    await generateQuestionBank({ job_id: 1 });
    expect(optionsOf(0).budget).toBe("analysis");
  });

  it("analyzeInterviewQuestion：答题思路", async () => {
    await analyzeInterviewQuestion({ question: "为什么离职？" });
    expect(optionsOf(0).budget).toBe("analysis");
  });

  it("optimizeResumeFromInterview：反向优化简历", async () => {
    await optimizeResumeFromInterview({ resume_id: 3, weaknesses: ["说不清难点"] });
    expect(optionsOf(0).budget).toBe("analysis");
  });

  it("createInterview：开场就会生成第一题", async () => {
    await createInterview({
      job_id: 1,
      resume_id: 2,
      interview_type: "技术面",
      difficulty: "中级",
      interviewer_style: "严谨专业",
      rounds: 12,
      rounds_min: 8,
    });
    expect(optionsOf(0).budget).toBe("analysis");
  });

  it("submitInterviewAnswer：非流式备用路径", async () => {
    await submitInterviewAnswer(7, "我的回答");
    expect(optionsOf(0).budget).toBe("analysis");
  });

  it("finishInterview：提前结束要生成评分报告", async () => {
    await finishInterview(7);
    expect(optionsOf(0).budget).toBe("analysis");
    expect(optionsOf(0).method).toBe("POST");
  });

  it("读类接口不受影响：列表/详情仍是默认预算", async () => {
    const { listInterviews, getInterview } = await import("./interview");
    await listInterviews();
    await getInterview(7);
    // 没显式传 budget：沿用 request() 的 default（15s）就够，读库不调模型。
    expect(optionsOf(0).budget).toBeUndefined();
    expect(optionsOf(1).budget).toBeUndefined();
  });
});
