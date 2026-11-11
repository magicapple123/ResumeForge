// SPDX-License-Identifier: Apache-2.0
/**
 * #30 语义检索回执的前端契约（从 `types/resume.ts` 拆出，行数预算）。
 *
 * 与后端 `services/rag/rag_visibility.py::rag_state_payload` 同形：
 * SSE `done.rag` 与 `GET /resumes/generate/tasks/{id}` 的 `rag` 字段都是这份结构。
 */

/** 回执里的单个影响条目（条目级，不是 chunk 级）。 */
export interface RagImpact {
  entry_id: string;
  title: string;
  section: string;
  /** 融合分（已 round 到 4 位）：只用于展示"提升了多少"，不是百分制。 */
  delta: number;
}

/**
 * 五态：必须能区分"配置开着"与"本次用上"。
 * off=未启用 / empty=索引为空 / miss=跑了没命中 / hit=命中 / fallback=超时回退。
 */
export type RagState = "off" | "empty" | "miss" | "hit" | "fallback";

/** 一次生成任务的语义检索回执。 */
export interface RagRetrieval {
  state: RagState;
  /** 命中条目数（不是 chunk 数：虚增会损害信任）。 */
  hit_count: number;
  expanded_terms: number;
  reason: string;
  /** state=hit 时与 hit_count 等长的明细列表。 */
  impacts?: RagImpact[];
  /** state=fallback 时的检索耗时，让用户分清"慢"和"坏"。 */
  elapsed_ms?: number;
}
