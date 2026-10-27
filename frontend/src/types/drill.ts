// SPDX-License-Identifier: Apache-2.0
/**
 * 面试深挖类型。
 *
 * 取值与后端 `models/drill.py` 的常量**逐字对应**——两处各一份最容易漂移，
 * 而这里的漂移会表现成"界面上能选、保存时 422"。
 */

/** 证据状态：决定这条主张讲不讲得清，也决定它要不要进复练队列。 */
export const EVIDENCE_STATUSES = [
  "verified",
  "partial",
  "unverified",
  "contradictory",
  "not_covered",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_COLORS: Record<EvidenceStatus, string> = {
  verified: "green",
  partial: "gold",
  unverified: "default",
  contradictory: "red",
  not_covered: "default",
};

/** 需要复练的状态：已验证的不必再练，未覆盖的只是没轮到。 */
export const REHEARSE_STATUSES: readonly EvidenceStatus[] = [
  "partial",
  "unverified",
  "contradictory",
];

/** 追问问题的类型：界面据此显示"这一问想查什么"。 */
export const FOLLOWUP_KINDS = [
  "background",
  "responsibility",
  "structure",
  "implementation",
  "decision",
  "alternative",
  "failure",
  "metric",
  "cost",
  "retrospective",
] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

/** 复练题型：不原题重复，换一个角度再问。 */
export const REHEARSE_KINDS = [
  "variant",
  "counterfactual",
  "failure",
  "evidence",
  "compress",
] as const;
export type RehearseKind = (typeof REHEARSE_KINDS)[number];

/** 反馈策略：真实模拟默认不在每题后念判定，训练模式则立刻反馈。 */
export const FEEDBACK_POLICIES = ["deferred", "immediate"] as const;
export type FeedbackPolicy = (typeof FEEDBACK_POLICIES)[number];

export interface DrillContract {
  id: number;
  claim_id: number | null;
  claim_title: string;
  question: string;
  intent: string;
  required_evidence: string[];
  followup_triggers: string[];
  stop_condition: string;
  status: EvidenceStatus;
  evidence_found: string[];
  missing: string[];
  contradictions: string[];
  followup_depth: number;
  next_followup_kind: string;
  created_at: string;
}

export interface DrillTurn {
  id: number;
  contract_id: number | null;
  question: string;
  answer: string;
  status: string;
  feedback: string;
  created_at: string;
}

export interface DrillAction {
  claim_title: string;
  /** 三选一：补事实 / 补知识 / 降表述。 */
  kind: string;
  detail: string;
}

export interface DrillRehearsalItem {
  claim_title: string;
  kind: string;
  why: string;
}

export interface DrillReview {
  covered?: string;
  verified_summary?: string;
  gaps_summary?: string;
  actions?: DrillAction[];
  rehearsal?: DrillRehearsalItem[];
}

export interface DrillSummary {
  questions: number;
  verified_count: number;
  partial_count: number;
  unverified_count: number;
  contradictory_count: number;
  status_counts: Record<string, number>;
}

export interface DrillSessionBrief {
  id: number;
  title: string;
  job_id: number | null;
  job_title: string;
  company: string;
  status: "active" | "finished";
  feedback_policy: FeedbackPolicy;
  max_questions: number;
  current_index: number;
  created_at: string;
}

export interface DrillSession extends DrillSessionBrief {
  contracts: DrillContract[];
  turns: DrillTurn[];
  review: DrillReview;
  summary: DrillSummary;
  /** 当前等待回答的那道题；界面据此显示"下一问"。 */
  pending: DrillContract | null;
}

export interface DrillAnswerResult {
  status: EvidenceStatus;
  evidence_found: string[];
  missing: string[];
  contradictions: string[];
  /** 真实模拟模式下为空——每题后念判定会让人按判分标准答题。 */
  feedback: string;
  finished: boolean;
  session: DrillSession;
}

export interface DrillCreatePayload {
  title?: string;
  job_id?: number | null;
  claim_ids?: number[];
  max_questions?: number;
  feedback_policy?: FeedbackPolicy;
}

export interface DrillRehearseResult {
  claim_title: string;
  kind: string;
  question: string;
  expect: string;
}

export interface DrillRehearsalRow extends DrillRehearsalItem {
  kind_label: string;
}

/** 可选的反馈策略与题数，界面直接用它们渲染下拉。 */
export const DRILL_QUESTION_OPTIONS = [3, 4, 6, 8, 10] as const;
