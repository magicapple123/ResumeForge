// ===== ① 匹配状态（五类）=====
export type MatchStatus =
  "matched" | "expression_gap" | "evidence_insufficient" | "real_gap" | "to_confirm";

export type HardGateResult = "met" | "unmet" | "unknown";
export type AdmissionResult = "allow" | "block" | "needs_confirm";

export interface MatchCondition {
  label: string;
  jd_quote: string;
  status: MatchStatus;
  evidence: string;
}

export interface JobMatchResult {
  hard_conditions: MatchCondition[];
  core_abilities: MatchCondition[];
  bonus_items: MatchCondition[];
  hard_gate: HardGateResult;
  admission: AdmissionResult;
  advice: string;
  notes: string[];
}

/** 参考分的单个分项（0-100 分 + 权重 + 一句可读的依据）。 */
export interface MatchScoreDimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  evidence: string;
}

/** 匹配度参考分：0-100 总分 + 5 个分项 + **后端下发的免责文案**。
 *
 * 它是**纯本地规则**算出来的派生值（不调模型）、**不参与投递准入**——能不能投仍只看
 * 五类结论。`disclaimer` 必须原样展示，不要自己改写或省略。
 */
export interface MatchReferenceScore {
  score: number;
  dimensions: MatchScoreDimension[];
  disclaimer: string;
}

export interface JobMatchOut {
  id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  result: JobMatchResult;
  hard_gate: HardGateResult;
  requires_confirm: boolean;
  model: string;
  created_at: string;
  updated_at: string;
  /** 派生值、仅展示、带免责；未分析过时为 null。 */
  reference_score: MatchReferenceScore | null;
}

export type JobMatchBatchItemStatus = "completed" | "failed";
export type JobMatchBatchAnalysisSource = "new" | "existing" | "local";

export interface JobMatchBatchItem {
  job_id: number;
  job_title: string;
  company: string;
  status: JobMatchBatchItemStatus;
  rank: number | null;
  reference_score: MatchReferenceScore | null;
  result: JobMatchResult | null;
  model: string;
  analysis_source: JobMatchBatchAnalysisSource | null;
  error: string;
}

export interface JobMatchBatchOut {
  id: number;
  requested_count: number;
  completed_count: number;
  failed_count: number;
  items: JobMatchBatchItem[];
  model: string;
  created_at: string;
  updated_at: string;
}

export interface JobMatchBatchSummary {
  id: number;
  requested_count: number;
  completed_count: number;
  failed_count: number;
  top_score: number | null;
  model: string;
  created_at: string;
}

export type JobMatchBackgroundTaskStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobMatchBackgroundTask {
  task_id: string;
  status: JobMatchBackgroundTaskStatus;
  job_ids: number[];
  force: boolean;
  requested_count: number;
  completed_count: number;
  failed_count: number;
  current_job_id: number | null;
  current_job_title: string;
  batch_id: number | null;
  message: string;
  error: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** 五类状态的中文名与展示色；`admission` 与后端闸门映射一致，仅用于说明，不用于判定。 */
export const MATCH_STATUS_META: Record<
  MatchStatus,
  { label: string; color: string; admission: AdmissionResult }
> = {
  matched: { label: "已匹配", color: "green", admission: "allow" },
  expression_gap: { label: "表达缺口", color: "blue", admission: "allow" },
  evidence_insufficient: { label: "证据不足", color: "orange", admission: "needs_confirm" },
  real_gap: { label: "真实缺口", color: "red", admission: "block" },
  to_confirm: { label: "待确认", color: "gold", admission: "needs_confirm" },
};

export const ADMISSION_META: Record<AdmissionResult, { label: string; color: string }> = {
  allow: { label: "可投递", color: "green" },
  needs_confirm: { label: "需确认", color: "orange" },
  block: { label: "不投", color: "red" },
};
