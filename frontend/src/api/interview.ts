// SPDX-License-Identifier: Apache-2.0
/** 模拟面试接口。
 *
 * **请求预算**：下面这些端点都会**现场调大模型**（开场、每轮提问+点评、题库、答题思路、
 * 参考答案、反向优化、评分报告），整段生成 10–60s 是常态。`request()` 的默认预算是
 * 15s（`BUDGETS_MS.default`），用它必然误超时——用户看到的就是"请求超时，请重试"。
 * 所以它们必须显式传 `budget: "analysis"`（180s）。流式那条
 * （`submitInterviewAnswerStream`）走 SSE、不限时，不需要预算。
 */
import { t } from "../i18n";
import type {
  InterviewAnalysis,
  InterviewAnswerReview,
  InterviewAnswerReviewPayload,
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
  // 开场就会现场生成第一道题（一次完整模型调用），必须走 analysis 预算。
  return request("/interview", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "analysis",
  });
}

/** 提交一轮回答：返回点评与下一题；满轮次时 finished 为真并且已带报告。 */
export function submitInterviewAnswer(id: number, content: string): Promise<InterviewAnswerResult> {
  // 非流式备用路径：同样是一次完整的"点评 + 下一题"生成。
  return request(`/interview/${id}/answers`, {
    method: "POST",
    body: JSON.stringify({ content }),
    budget: "analysis",
  });
}

/**
 * 流式事件：
 * - ``phase``：阶段切换（目前只有 ``finishing``＝本轮之后要出报告）。**提前**告知，
 *   界面才能把"正在思考下一个问题"换成"本场面试结束，正在生成报告"，而不是傻等。
 * - ``question_delta``：问题明文增量；``done``：完整结果；``error``：失败原因。
 */
export interface InterviewAnswerStreamEvent {
  type: "phase" | "question_delta" | "done" | "error";
  phase?: "finishing";
  text?: string;
  detail?: string;
  result?: InterviewAnswerResult;
}

/**
 * 流式提交一轮回答：``question_delta`` 把面试官的问题逐字推来（onQuestionDelta 渐进
 * 渲染），``done`` 带完整结果（与旧端点同形状）。失败走 ``error`` 事件（回答已存档）。
 *
 * ``signal`` 用于「停止本轮」：abort 之后浏览器断开连接，服务端随即停下这一轮并把那条
 * 回答标成 interrupted（不删数据），用户可以重答。
 */
export async function submitInterviewAnswerStream(
  id: number,
  content: string,
  onQuestionDelta: (text: string) => void,
  /** 阶段回调：收到 ``finishing`` 时界面应立刻切到"正在生成报告"。 */
  onPhase?: (phase: "finishing") => void,
  /** 停止本轮用：abort 即断开，服务端不再继续烧 token。 */
  signal?: AbortSignal,
): Promise<InterviewAnswerResult> {
  let result: InterviewAnswerResult | null = null;
  // 注意必须带 `/api` 前缀：consumeSSE 拿到什么就 fetch 什么（不像 request() 会自动
  // 补前缀），漏了就会打到前端自身源上 → 404「请求失败（HTTP 404）」。
  await consumeSSE<InterviewAnswerStreamEvent>(
    `/api/interview/${id}/answers/stream`,
    { content },
    (event) => {
      if (event.type === "phase" && event.phase) onPhase?.(event.phase);
      else if (event.type === "question_delta" && event.text) onQuestionDelta(event.text);
      else if (event.type === "done" && event.result) result = event.result;
      else if (event.type === "error")
        throw new Error(event.detail || t("apiErrors.interview.streamFailed"));
    },
    signal,
  );
  if (!result) throw new Error(t("apiErrors.interview.streamFailed"));
  return result;
}

/** 提前结束并出报告。 */
export function finishInterview(id: number): Promise<InterviewDetail> {
  // 提前结束时要生成整份评分报告，是这条链路里最慢的一次调用。
  return request(`/interview/${id}/finish`, { method: "POST", budget: "analysis" });
}

/** 上报累计的**有效面试时长**（秒，绝对值；服务端取大值防回退）。 */
export function updateInterviewDuration(
  id: number,
  elapsedSeconds: number,
): Promise<InterviewBrief> {
  return request(`/interview/${id}/duration`, {
    method: "PUT",
    body: JSON.stringify({ elapsed_seconds: elapsedSeconds }),
  });
}

export function deleteInterview(id: number): Promise<void> {
  return request(`/interview/${id}`, { method: "DELETE" });
}

/** 把这场面试的记录与报告存进资料箱（面试复盘）。 */
export function interviewToMaterial(id: number): Promise<Material> {
  return request(`/interview/${id}/to-material`, { method: "POST" });
}

/** 生成个性化题库（基础/项目深挖/反问 HR 三类，即时生成不落库）。 */
export function generateQuestionBank(
  payload: QuestionBankPayload,
  signal?: AbortSignal,
): Promise<QuestionBankOut> {
  return request("/interview/questions", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "analysis",
    signal,
  });
}

/** 输入一道真实问题，分析答题思路。 */
export function analyzeInterviewQuestion(
  payload: InterviewAnalysisPayload,
  signal?: AbortSignal,
): Promise<InterviewAnalysis> {
  return request("/interview/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "analysis",
    signal,
  });
}

/** 为单道题生成详细参考答案（正文 + 要点 + 话术）。 */
export function generateQuestionAnswer(
  payload: QuestionAnswerPayload,
  signal?: AbortSignal,
): Promise<QuestionAnswer> {
  // 「参考答案」是一次完整的长文生成（正文 + 要点 + 话术），实测必然超过 15s。
  return request("/interview/questions/answer", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "analysis",
    signal,
  });
}

/** 把自己写的作答交给 AI 批改（打分 + 解析 + 修改建议 + 改写示范）；同样是一次长文生成。 */
export function reviewQuestionAnswer(
  payload: InterviewAnswerReviewPayload,
  signal?: AbortSignal,
): Promise<InterviewAnswerReview> {
  return request("/interview/questions/review", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "analysis",
    signal,
  });
}

/** 把面试暴露的短板与高频追问反向转成简历改写建议（只出建议、不改正文）。 */
export function optimizeResumeFromInterview(
  payload: InterviewOptimizePayload,
  signal?: AbortSignal,
): Promise<InterviewOptimizeResult> {
  return request("/interview/optimize-resume", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "analysis",
    signal,
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
