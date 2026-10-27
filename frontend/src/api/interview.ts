// SPDX-License-Identifier: Apache-2.0
/** 模拟面试接口。 */
import { t } from "../i18n";
import type {
  InterviewAnalysis,
  InterviewAnalysisPayload,
  InterviewAnswerResult,
  InterviewBrief,
  InterviewCreatePayload,
  InterviewDetail,
  InterviewOptimizePayload,
  InterviewOptimizeResult,
  InterviewReviewRecord,
  InterviewReviewRecordPayload,
  Material,
  QuestionAnswer,
  QuestionAnswerPayload,
  QuestionBankOut,
  QuestionBankPayload,
  QuestionBankRecord,
  QuestionBankRecordPayload,
} from "../types";
import { request } from "./client";
import { consumeSSE } from "./stream";

export function listInterviews(limit = 50): Promise<InterviewBrief[]> {
  return request(`/interview?limit=${limit}`);
}

export function getInterview(id: number): Promise<InterviewDetail> {
  return request(`/interview/${id}`);
}

/** 开一场面试；后端会同时生成第一个问题。 */
export function createInterview(payload: InterviewCreatePayload): Promise<InterviewDetail> {
  return request("/interview", { method: "POST", body: JSON.stringify(payload) });
}

/** 提交一轮回答：返回点评与下一题；满轮次时 finished 为真并且已带报告。 */
export function submitInterviewAnswer(id: number, content: string): Promise<InterviewAnswerResult> {
  return request(`/interview/${id}/answers`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export interface InterviewAnswerStreamEvent {
  type: "question_delta" | "done" | "error";
  text?: string;
  detail?: string;
  result?: InterviewAnswerResult;
}

/**
 * 流式提交一轮回答：``question_delta`` 把面试官的问题逐字推来（onQuestionDelta 渐进
 * 渲染），``done`` 带完整结果（与旧端点同形状）。失败走 ``error`` 事件（回答已存档）。
 */
export async function submitInterviewAnswerStream(
  id: number,
  content: string,
  onQuestionDelta: (text: string) => void,
): Promise<InterviewAnswerResult> {
  let result: InterviewAnswerResult | null = null;
  // 注意必须带 `/api` 前缀：consumeSSE 拿到什么就 fetch 什么（不像 request() 会自动
  // 补前缀），漏了就会打到前端自身源上 → 404「请求失败（HTTP 404）」。
  await consumeSSE<InterviewAnswerStreamEvent>(
    `/api/interview/${id}/answers/stream`,
    { content },
    (event) => {
      if (event.type === "question_delta" && event.text) onQuestionDelta(event.text);
      else if (event.type === "done" && event.result) result = event.result;
      else if (event.type === "error")
        throw new Error(event.detail || t("apiErrors.interview.streamFailed"));
    },
  );
  if (!result) throw new Error(t("apiErrors.interview.streamFailed"));
  return result;
}

/** 提前结束并出报告。 */
export function finishInterview(id: number): Promise<InterviewDetail> {
  return request(`/interview/${id}/finish`, { method: "POST" });
}

export function deleteInterview(id: number): Promise<void> {
  return request(`/interview/${id}`, { method: "DELETE" });
}

/** 把这场面试的记录与报告存进资料箱（面试复盘）。 */
export function interviewToMaterial(id: number): Promise<Material> {
  return request(`/interview/${id}/to-material`, { method: "POST" });
}

/** 生成个性化题库（基础/项目深挖/反问 HR 三类，即时生成不落库）。 */
export function generateQuestionBank(payload: QuestionBankPayload): Promise<QuestionBankOut> {
  return request("/interview/questions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 输入一道真实问题，分析答题思路。 */
export function analyzeInterviewQuestion(
  payload: InterviewAnalysisPayload,
): Promise<InterviewAnalysis> {
  return request("/interview/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 为单道题生成详细参考答案（正文 + 要点 + 话术）。 */
export function generateQuestionAnswer(payload: QuestionAnswerPayload): Promise<QuestionAnswer> {
  return request("/interview/questions/answer", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 把面试暴露的短板与高频追问反向转成简历改写建议（只出建议、不改正文）。 */
export function optimizeResumeFromInterview(
  payload: InterviewOptimizePayload,
): Promise<InterviewOptimizeResult> {
  return request("/interview/optimize-resume", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ===== D5 题库历史 / 面试复盘历史 =====

/** 保存一次生成的题库为历史。 */
export function saveQuestionBank(payload: QuestionBankRecordPayload): Promise<QuestionBankRecord> {
  return request("/interview/question-banks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listQuestionBanks(): Promise<QuestionBankRecord[]> {
  return request("/interview/question-banks");
}

export function getQuestionBank(id: number): Promise<QuestionBankRecord> {
  return request(`/interview/question-banks/${id}`);
}

/** 删除题库历史（软删，彻底删除在回收站）。 */
export function deleteQuestionBank(id: number): Promise<void> {
  return request(`/interview/question-banks/${id}`, { method: "DELETE" });
}

/** 局部更新题库历史（历史记录富还原：把新生成的参考答案写回同一条记录）。 */
export function updateQuestionBank(
  id: number,
  payload: Partial<QuestionBankRecordPayload>,
): Promise<QuestionBankRecord> {
  return request(`/interview/question-banks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** 保存一次面试复盘为历史。 */
export function saveReview(payload: InterviewReviewRecordPayload): Promise<InterviewReviewRecord> {
  return request("/interview/reviews", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listReviews(): Promise<InterviewReviewRecord[]> {
  return request("/interview/reviews");
}

export function getReview(id: number): Promise<InterviewReviewRecord> {
  return request(`/interview/reviews/${id}`);
}

/** 删除复盘历史（软删，彻底删除在回收站）。 */
export function deleteReview(id: number): Promise<void> {
  return request(`/interview/reviews/${id}`, { method: "DELETE" });
}

/** 局部更新复盘历史（历史记录富还原：把新复盘/反向优化结果写回同一条记录）。 */
export function updateReview(
  id: number,
  payload: Partial<InterviewReviewRecordPayload>,
): Promise<InterviewReviewRecord> {
  return request(`/interview/reviews/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
