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

/**
 * 一条无法在当前正文里定位的旧关联（P5-2，只读暴露）。
 * 旧行不迁移、不改写；界面据此前去删除或重新关联，绝不自动猜目标。
 */
export interface UnresolvedLinkOut {
  link_id: number;
  source_id: number;
  source_title: string;
  source_kind: string;
  object_id: string | null;
  point_id: string | null;
  path: string;
  field: string;
  /** 稳定原因码：object_id_invalid / no_locator / target_missing。 */
  reason: string;
}

export interface ResumeProvenanceOut {
  resume_id: number;
  revision: number;
  sources: SourceOut[];
  objects: DocumentObjectOut[];
  /** P5-2 只增字段：解析不到的旧关联（后端恒返回，旧客户端忽略即可）。 */
  unresolved_links: UnresolvedLinkOut[];
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

/** 建立/刷新关联的请求体（旧契约 POST /provenance/resumes/{id}/links，保留兼容）。 */
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

// ===== W12 冻结契约（be-prov）：来源列表 + 关联 + 采纳写正文 =====

/** 数据集级来源（GET /api/provenance/sources 的列表项，be-prov 最终实现）。 */
export interface ProvenanceSourceBriefOut {
  id: number;
  kind: string;
  external_ref: string | null;
  title: string;
  current_fingerprint: string;
  metadata: Record<string, unknown>;
  latest_revision_no: number;
  created_at: string | null;
  updated_at: string | null;
}

/** 来源修订列表项（GET /sources/{id}/revisions；只有展示信息，无正文/指纹）。 */
export interface SourceRevisionItemOut {
  id: number;
  revision_no: number;
  summary: string;
  captured_at: string | null;
}

export interface SourceRevisionsOut {
  source_id: number;
  revisions: SourceRevisionItemOut[];
}

/**
 * GET /sources/{id}/revision-text：来源修订原文（只读，供 adopt 预填）。
 * resolvable=false 表示这条来源没有可读取的正文（如手工来源），reason 说明原因。
 */
export interface RevisionTextViewOut {
  source_id: number;
  kind: string;
  external_ref: string | null;
  /** 历史修订可能没有 revision_no（不可解析时）。 */
  revision_no: number | null;
  text: string;
  fingerprint: string;
  resolvable: boolean;
  /** 原文是否是算指纹用的那份（false 时界面提示核对）。 */
  fingerprint_matched: boolean;
  is_latest: boolean;
  /** 稳定码：manual_source_has_no_body / external_ref_unresolvable / ... */
  reason: string;
}

/** POST /sources 的响应（手工来源：来源 + 首条修订）。 */
export interface ManualSourceOut {
  id: number;
  kind: string;
  /** P5-1 只增字段：带 external_ref 新建/复用时回显来源身份。 */
  external_ref?: string | null;
  title: string;
  revision: SourceRevisionItemOut;
}

/**
 * POST /sources 的请求体（P5-1）。
 *
 * 兼容性：只给 title 时与旧请求等价（kind=manual、不带 external_ref/payload），
 * 后端据此走 {"title": title} 的旧默认 payload，历史来源指纹不变。
 */
export interface ManualSourceCreateInput {
  title: string;
  kind?: SourceKind;
  external_ref?: string | null;
  /** 原文摘要：只参与指纹/修订判断，不落来源表（后端上限 2000 字符）。 */
  payload?: string | null;
}

export interface ProvenanceSourceListOut {
  items: ProvenanceSourceBriefOut[];
  total: number;
}

/** POST /api/provenance/links（新契约）：只引用已有 source_id，不 upsert。 */
export interface SourceLinkCreateRequest {
  resume_id: number;
  source_id: number;
  source_revision_id?: number | null;
  object_id?: string | null;
  point_id?: string | null;
  path?: string | null;
  field?: string | null;
}

/** POST /api/provenance/links/{link_id}/adopt：把来源新文本写回一个块。 */
export interface AdoptLinkRequest {
  text: string;
  expected_revision?: number;
  source_revision_id?: number | null;
  path?: string | null;
}

export interface AdoptLinkOut {
  resume_id: number;
  revision: number;
  content: Record<string, unknown>;
  applied_path: string;
  link: BlockLinkOut;
  source_revision_no: number;
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
  /** 输入拆两档（0067）：只累加有记录的行；cache_unknown_calls 说明有多少条老账本没记。 */
  cache_hit_tokens?: number | null;
  cache_miss_tokens?: number | null;
  cache_unknown_calls?: number;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  unknown_token_calls: number;
  /** R04：按 finish_reason 的调用计数（be-prov 契约，逐桶下发）。 */
  finish_reasons?: Record<string, number>;
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

/**
 * 一份单价（**每百万 token**）：输入拆缓存命中 / 未命中，输出单独一档。
 * 三档至少填一个——没有缓存折扣的服务商把命中档留空即可。
 */
export interface UsagePricingIn {
  name: string;
  input_cache_hit_per_million: number | null;
  input_cache_miss_per_million: number | null;
  output_per_million: number | null;
  currency: string;
}

/** GET|PUT /api/usage/pricing：当前生效的单价（configured=false = 未配置）。 */
export interface UsagePricingOut {
  configured?: boolean;
  input_cache_hit_per_million: number | null;
  input_cache_miss_per_million: number | null;
  output_per_million: number | null;
  currency: string;
  /** record = 单价记录；settings / environment = 老格式兜底。 */
  source?: string;
  record_id?: number | null;
  name?: string;
}

/** GET /api/usage/pricing/records：一条可命名、可回溯的单价记录。 */
export interface UsagePricingRecordOut {
  id: number;
  name: string;
  input_cache_hit_per_million: number | null;
  input_cache_miss_per_million: number | null;
  output_per_million: number | null;
  currency: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface UsagePricingRecordListOut {
  items: UsagePricingRecordOut[];
  count: number;
}

/** GET /api/usage/records 的单条记录（含 finish_reason，无正文）。 */
export interface UsageRecordOut {
  id: number;
  task: string;
  model: string;
  finish_reason: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  retries: number;
  created_at: string | null;
}

export interface UsageRecordListOut {
  items: UsageRecordOut[];
  count: number;
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
