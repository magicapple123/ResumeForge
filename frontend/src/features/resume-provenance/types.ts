// SPDX-License-Identifier: Apache-2.0
/**
 * W12-FE 的前端类型，逐字段对应后端契约（`backend/app/schemas/provenance.py` /
 * `usage.py` / `outbound.py` / `resume_writing.RewriteFieldOut`）。
 *
 * 这些接口**已经就绪**（be-data 的 W12-BE 已交付），所以这里是真实 API 形状，不是 mock。
 * 未关联 = `link: null`（契约 §2：不猜关系）；`status` 只有 linked / stale 两种派生值。
 */

// ===== 来源 =====
export type SourceKind = "claim" | "material" | "job" | "profile" | "manual";
export type LinkStatus = "linked" | "stale";

export interface SourceRevisionOut {
  revision_no: number;
  fingerprint: string;
  summary: string;
  captured_at: string | null;
}

export interface BlockLinkOut {
  link_id: number;
  source_id: number;
  object_id: string | null;
  point_id: string | null;
  path: string;
  field: string;
  source_fingerprint: string;
  status: LinkStatus;
}

export interface SourceOut {
  id: number;
  kind: SourceKind | string;
  external_ref: string | null;
  title: string;
  current_fingerprint: string;
  latest_revision_no: number;
  revisions: SourceRevisionOut[];
  blocks: BlockLinkOut[];
}

export interface DocumentObjectOut {
  path: string;
  field: string;
  object_id: string | null;
  point_id: string | null;
  label: string;
  /** null = 未建立来源关联（旧记录不会被自动猜测）。 */
  link: BlockLinkOut | null;
}

export interface ProvenanceCoverage {
  total: number;
  linked: number;
  unlinked: number;
}

export interface ResumeProvenanceOut {
  resume_id: number;
  revision: number;
  sources: SourceOut[];
  objects: DocumentObjectOut[];
  coverage: ProvenanceCoverage;
}

export interface SourceImpactEntryOut {
  resume_id: number;
  resume_title: string;
  link_id: number;
  source_id: number;
  object_id: string | null;
  point_id: string | null;
  path: string;
  field: string;
  linked_fingerprint: string;
  current_fingerprint: string;
  stale: boolean;
  resume_deleted: boolean;
}

export interface SourceImpactOut {
  source_id: number;
  kind: string;
  title: string;
  current_fingerprint: string;
  affected: SourceImpactEntryOut[];
  stale_count: number;
}

export interface SourceChainOut {
  resume_id: number;
  object_id: string | null;
  point_id: string | null;
  path: string;
  sources: SourceOut[];
}

/** 建立/刷新关联的请求体（POST /provenance/resumes/{id}/links）。 */
export interface LinkCreateRequest {
  source: {
    kind: SourceKind;
    external_ref?: string | null;
    title?: string;
    payload?: unknown;
    metadata?: Record<string, unknown>;
  };
  object_id?: string | null;
  point_id?: string | null;
  path?: string | null;
  field?: string | null;
}

// ===== 事实锁 =====
export type FactLockKind = "name" | "institution" | "time" | "number" | "responsibility_boundary";

export const FACT_LOCK_KINDS: readonly FactLockKind[] = [
  "name",
  "institution",
  "time",
  "number",
  "responsibility_boundary",
];

export interface FactLockOut {
  id: number;
  resume_id: number;
  kind: FactLockKind | string;
  object_id: string | null;
  point_id: string | null;
  path: string;
  field: string;
  locked_value: string;
  label: string;
  created_at: string | null;
}

export interface FactLockListOut {
  resume_id: number;
  revision: number;
  locks: FactLockOut[];
}

export interface FactLockCreateRequest {
  kind: FactLockKind;
  object_id?: string | null;
  point_id?: string | null;
  path?: string | null;
  label?: string;
}

export interface FactLockViolationOut {
  lock_id: number;
  kind: string;
  label: string;
  path: string;
  field: string;
  reason: string;
  locked_value: string;
  current_value: string;
}

export interface FactLockConflictOut {
  detail: string;
  code: "fact_lock_conflict";
  violations: FactLockViolationOut[];
}

// ===== 用量（R04） =====
export interface UsageBucketOut {
  key: string;
  calls: number;
  retries: number;
  /** null = 存在未知用量（不是 0）。 */
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  unknown_token_calls: number;
}

export interface UsageCostOut {
  estimated: boolean;
  currency: string;
  amount: number | null;
  reason: string;
}

export interface UsageSummaryOut {
  dataset_id: string | null;
  records: number;
  since: string | null;
  tasks: UsageBucketOut[];
  models: UsageBucketOut[];
  totals: UsageBucketOut;
  unknown_token_records: number;
  cost: UsageCostOut;
}

// ===== 外发预览（R04） =====
export interface OutboundPreviewRequest {
  target_service: string;
  material_categories?: string[];
  attachment_types?: string[];
  excluded_fields?: string[];
  fetch_pages?: boolean;
  body?: string;
}

export interface OutboundPreviewOut {
  target_service: string;
  material_categories: string[];
  attachment_types: string[];
  excluded_fields: string[];
  fetch_pages: boolean;
  body_preview: string;
  body_chars: number;
  body_truncated: boolean;
  body_sha256: string;
  secret_leak_detected: boolean;
  persistence: "memory_only";
}

// ===== 局部写作候选 =====
export type CandidateMode = "concise" | "method" | "result";

export const CANDIDATE_MODES: readonly CandidateMode[] = ["concise", "method", "result"];

export interface RewriteFieldOut {
  path: string;
  label: string;
  context: string;
  original: string;
  result: string;
  kind: "text" | "lines";
  lines: string[];
}

/** 一条候选在界面上的状态机（加载/就绪/失败/过期）。 */
export interface WritingCandidateState {
  mode: CandidateMode;
  status: "idle" | "loading" | "ready" | "error" | "stale";
  /** 后端返回的候选（status=ready 时有值）。 */
  suggestion: RewriteFieldOut | null;
  /** 失败原因（已本地化的用户提示）。 */
  errorMessage: string;
}
