// SPDX-License-Identifier: Apache-2.0
/** 模拟面试（后端 /api/interview）。 */
import type { ResumeSuggestion } from "./resume";

export const INTERVIEW_TYPES = [
  "技术面",
  "项目深挖",
  "行为面（STAR）",
  "HR 面",
  "综合面",
  "案例分析",
  "英语面试",
  "压力面",
] as const;

export const INTERVIEW_DIFFICULTIES = ["初级", "中级", "高级"] as const;

export const INTERVIEWER_STYLES = ["严谨专业", "温和引导", "持续追问", "压力质询"] as const;

export type InterviewType = (typeof INTERVIEW_TYPES)[number];
export type InterviewDifficulty = (typeof INTERVIEW_DIFFICULTIES)[number];
export type InterviewerStyle = (typeof INTERVIEWER_STYLES)[number];
export type InterviewStatus = "active" | "finished";

export const MIN_INTERVIEW_ROUNDS = 3;
export const MAX_INTERVIEW_ROUNDS = 12;

/** 自动收尾模式：何时结束完全由 AI 判断，界面与提示词都不给出轮数范围；
 *  AUTO_FINISH_MAX_ROUNDS 只是服务端的硬性保险（防对话失控），不向用户/模型展示。 */
export const AUTO_FINISH_MAX_ROUNDS = 12;
/** 自动收尾模式随表单提交的 rounds_min：语义是「自动收尾的最早轮数下限」。
 *
 *  取 8（而不是产品的最低下限 3）：真实面试通常要聊 8 轮以上才看得出一场对话的分量，
 *  取下限时 AI 从第 3 轮起就被允许收尾，实测常常问 3~4 题就结束——"自动"变成了
 *  "尽快结束"。**尽量像真实面试那样多聊几轮，只有明显聊透才收尾**；上限仍是
 *  AUTO_FINISH_MAX_ROUNDS（必须严格大于它，后端校验 rounds_min < rounds）。 */
export const AUTO_ROUNDS_FLAG = 8;

export interface InterviewMessage {
  id: number;
  role: "interviewer" | "user" | "note";
  /**
   * 阶段（#41）：`interview` = 正式问答（计入轮次），`followup` = 结束后的追问（不计轮次）。
   *
   * 服务端总会带这个字段（后端 schema 把缺失值补成 `interview`）；这里仍是可选的，
   * 因为"缺失"的语义就是正式问答——老会话、以及按旧结构构造的测试数据都落在这个分支上，
   * 让它们继续按"正式问答"渲染才是对的。
   */
  phase?: InterviewMessagePhase;
  content: string;
  context: {
    index?: number;
    rounds?: number;
    feedback?: string;
    persona?: string;
  };
  status: string;
  error: string;
  created_at: string;
}

/** 消息所属阶段。历史消息（0071 之前）一律是 `interview`，服务端已补齐默认值。 */
export type InterviewMessagePhase = "interview" | "followup";

/** 材料来源（#41）：岗位侧导入 JD 文件，简历侧导入截图。 */
export type InterviewMaterialKind = "job" | "resume";

/** 开面试时随请求带上的、**已提取**的材料（文件名 + 正文）。 */
export interface InterviewMaterialPayload {
  name: string;
  text: string;
}

/** 上传端点返回的提取结果：用户在上传那一刻就能看到"识别出什么、有什么警告"。 */
export interface InterviewMaterialExtract {
  name: string;
  text: string;
  warnings: string[];
}

export interface InterviewReportDimension {
  name: string;
  score: number;
  comment: string;
}

export interface InterviewReport {
  score?: number;
  dimensions?: InterviewReportDimension[];
  strengths?: string[];
  improvements?: string[];
  summary?: string;
  /** 报告生成失败时后端留下说明，界面按"无报告"处理并展示原因。 */
  error?: boolean;
}

export interface InterviewBrief {
  id: number;
  title: string;
  job_id: number | null;
  job_title: string;
  company: string;
  /** 关联简历（面试官只读这份简历 + 关联岗位的 JD）；历史会话可能为 null。 */
  resume_id: number | null;
  resume_title: string;
  /**
   * 导入的材料文件名（#41）：缺失/空串表示该侧材料来自记录（历史会话也是如此）。
   * 后端总会带上这两个字段；写成可选是因为"没有文件"就是它们的常态。
   */
  job_material_name?: string;
  resume_material_name?: string;
  /** 累计有效面试时长（秒）：点「准备好了」之后才开始计时、离开暂停。 */
  duration_seconds: number;
  interview_type: InterviewType | string;
  difficulty: InterviewDifficulty | string;
  interviewer_style: InterviewerStyle | string;
  rounds: number;
  /** 自动轮数下限：非空 = AI 按表现收尾（rounds 兼作上限），界面不显示精确总轮数。 */
  rounds_min: number | null;
  status: InterviewStatus;
  created_at: string;
  updated_at: string;
  /**
   * 追问区收起的时刻（#41）：非空 = 用户点了「停止追问」，输入框收起。
   * 它不改 status、不影响 answered_rounds——历史会话没有这个字段时为 undefined（= 开放）。
   */
  follow_up_closed_at?: string | null;
  answered_rounds: number;
}

export interface InterviewDetail extends InterviewBrief {
  persona: string;
  focus: string;
  model: string;
  report: InterviewReport;
  messages: InterviewMessage[];
}

export interface InterviewCreatePayload {
  title?: string;
  /** 关联岗位：与 `job_material` **二选一**（每侧必须有一个来源，后端会校验）。 */
  job_id?: number;
  /** 关联简历：与 `resume_material` 二选一。 */
  resume_id?: number;
  /** 导入的 JD 文件（已提取的文本）。 */
  job_material?: InterviewMaterialPayload;
  /** 导入的简历截图（已识别出的文本）。 */
  resume_material?: InterviewMaterialPayload;
  interview_type: InterviewType;
  difficulty: InterviewDifficulty;
  interviewer_style: InterviewerStyle;
  rounds: number;
  rounds_min?: number | null;
  persona?: string;
  focus?: string;
}

export interface InterviewAnswerResult {
  session: InterviewDetail;
  feedback: string;
  finished: boolean;
}

/** 一次追问的结果（#41）：面试官的回答 + 刷新后的整场会话。 */
export interface InterviewFollowUpResult {
  session: InterviewDetail;
  answer: string;
}

// ===== R-11 个性化题库 / 答题思路 / 反向优化简历 =====

export const QUESTION_BANK_TYPES = ["基础题", "项目深挖题", "反问HR题"] as const;
export type QuestionBankType = (typeof QUESTION_BANK_TYPES)[number];

export interface InterviewQuestionItem {
  question: string;
  purpose: string;
  answer_hint: string;
  /** 已生成的参考答案（历史记录富还原：打开历史题库时若已存在则直接展示，不必重新生成）。 */
  answer?: string | null;
  key_points?: string[] | null;
  sample_phrasing?: string | null;
  /** 候选人自己写的作答（随题库历史保存，重新打开还在）。 */
  my_answer?: string;
  /** 自答的批改结果；没批改过就是空对象。 */
  review?: InterviewAnswerReview | null;
}

export interface QuestionBankGroup {
  type: string;
  questions: InterviewQuestionItem[];
}

export interface QuestionBankOut {
  job_id: number | null;
  job_title: string;
  company: string;
  resume_id: number | null;
  groups: QuestionBankGroup[];
  llm_used: boolean;
  notes: string[];
}

export interface QuestionBankPayload {
  job_id?: number | null;
  resume_id?: number | null;
}

export interface InterviewAnalysisPayload {
  question: string;
  job_id?: number | null;
  resume_id?: number | null;
  context?: string;
}

export interface InterviewAnalysis {
  question: string;
  framework: string;
  key_points: string[];
  follow_up: string[];
  pitfalls: string[];
}

export interface QuestionAnswerPayload {
  question: string;
  job_id?: number | null;
  resume_id?: number | null;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
  key_points: string[];
  sample_phrasing: string;
}

/** 自答的批改结果：分数 + 总评 + 亮点 / 差距 / 修改建议 + 改写示范。 */
export interface InterviewAnswerReview {
  question: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  revised_answer: string;
}

export interface InterviewAnswerReviewPayload {
  question: string;
  my_answer: string;
  job_id?: number | null;
  resume_id?: number | null;
  /** 已生成参考答案时一并带上，批改会对照"标准答法"指出差在哪。 */
  reference_answer?: string;
}

export interface InterviewOptimizePayload {
  resume_id: number;
  job_id?: number | null;
  weaknesses?: string[];
  follow_ups?: string[];
}

export interface InterviewOptimizeResult {
  resume_id: number;
  suggestions: ResumeSuggestion[];
  llm_used: boolean;
  notes: string[];
}

// ===== D5 题库历史 / 面试复盘历史 =====

export interface QuestionBankRecord {
  id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  resume_id: number | null;
  resume_title: string;
  groups: QuestionBankGroup[];
  model: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionBankRecordPayload {
  job_id?: number | null;
  job_title?: string;
  company?: string;
  resume_id?: number | null;
  resume_title?: string;
  groups: QuestionBankGroup[];
  model?: string;
}

export interface InterviewReviewRecord {
  id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  resume_id: number | null;
  resume_title: string;
  questions: string[];
  analysis: InterviewAnalysis;
  suggestions: ResumeSuggestion[];
  model: string;
  created_at: string;
  updated_at: string;
}

export interface InterviewReviewRecordPayload {
  job_id?: number | null;
  job_title?: string;
  company?: string;
  resume_id?: number | null;
  resume_title?: string;
  questions: string[];
  analysis: InterviewAnalysis;
  suggestions: ResumeSuggestion[];
  model?: string;
}
