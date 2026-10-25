// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产（W17 / D16）的前端类型，与 Wave3 契约 §3.2 的 `resume_phrase` 表逐字段对齐。
 *
 * 后端表（`backend/app/models/resume_phrase.py`）尚未落地时，本文件是组件与测试的唯一来源；
 * 后端 schema 就绪后只改这一个文件的字段来源（组件不感知）。
 *
 * 两条语义硬约束（契约 §3.3）：
 * 1. 插入简历时由**宿主**生成新的 object_id / point_id——资产不携带简历身份；
 * 2. 资产之后被编辑**不会**回写已插入的简历（更新要走"先看差异再采纳"）。
 */

/** 资产类型（与后端 `kind` 列的白名单逐字一致）。 */
export type PhraseKind = "achievement" | "method" | "result" | "summary" | "custom";

export const PHRASE_KINDS: readonly PhraseKind[] = [
  "achievement",
  "method",
  "result",
  "summary",
  "custom",
];

/** 来源类别：事实台账 / 简历要点 / 手工登记。 */
export type PhraseSourceKind = "claim" | "resume" | "manual";

export const PHRASE_SOURCES: readonly PhraseSourceKind[] = ["claim", "resume", "manual"];

/** 一条表达资产（后端 `resume_phrase` 的读出形状）。 */
export interface ResumePhrase {
  id: number;
  /** 表达正文（≤2000；允许既有 `**加粗**` 标记）。 */
  text: string;
  kind: PhraseKind;
  /** 语言标签：zh-CN / en-US / 空串（未标注）。 */
  language: string;
  /** 岗位/技能标签（≤20 个，每个 ≤32 字），只做本地包含匹配。 */
  job_tags: string[];
  /** 来源事实台账条目 id（可空 → FK SET NULL 后为 null）。 */
  source_claim_id: number | null;
  /** 来源简历 id（可空）。 */
  source_resume_id: number | null;
  /** 首次收藏时的简历对象 id（W01；可空）。 */
  source_object_id: string | null;
  /** 用户自述"为什么这条好"。 */
  quality_note: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string | null;
  updated_at?: string | null;
}

/** GET /api/resume-phrases 的响应（游标分页）。 */
export interface PhraseListOut {
  items: ResumePhrase[];
  next_cursor: number | null;
}

/** POST /api/resume-phrases 的请求体（与后端 PhraseIn 逐字段一致）。 */
export interface PhraseInPayload {
  text: string;
  kind: PhraseKind;
  language: string;
  source_claim_id?: number | null;
  source_resume_id?: number | null;
  source_object_id?: string | null;
  job_tags: string[];
  quality_note: string;
}

/** PATCH /api/resume-phrases/{id}：只提交要改的字段。 */
export interface PhraseUpdatePayload {
  text?: string;
  kind?: PhraseKind;
  language?: string;
  job_tags?: string[];
  quality_note?: string;
}

/**
 * PATCH 响应：更新后的资产 + `previous`（旧快照，be-prov 契约）。
 * `previous` 供「更新先看差异」做核对/审计；本地 diff 不依赖它（旧后端缺省也不报错）。
 */
export interface PhraseUpdateOut extends ResumePhrase {
  previous?: ResumePhrase | null;
}

/** POST /api/resume-phrases/{id}/insert。 */
export interface PhraseInsertPayload {
  resume_id: number;
  section: string;
  entry_id?: string | null;
  point_index?: number | null;
  expected_revision?: number | null;
}

/** 插入结果：新对象身份 + 已保存的简历（供宿主刷新编辑器/预览）。 */
export interface PhraseInsertOut {
  resume: unknown;
  phrase: ResumePhrase;
  inserted_object_id: string;
  inserted_point_id: string | null;
}

/** 筛选状态（UI 受控状态，与服务端查询参数一一对应）。 */
export interface PhraseFilterState {
  keyword: string;
  kind: PhraseKind | "all";
  language: string | "all";
  tag: string | "all";
  sort: PhraseSort;
}

export type PhraseSort = "recent" | "usage" | "created";

/** 来源摘要（UI 只展示"来自哪类"，不暴露具体文本）。 */
export function phraseSourceKind(phrase: ResumePhrase): PhraseSourceKind {
  if (phrase.source_claim_id !== null) return "claim";
  if (phrase.source_resume_id !== null) return "resume";
  return "manual";
}
