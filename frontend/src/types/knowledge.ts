// SPDX-License-Identifier: Apache-2.0
/** 知识库条目类型。 */

export interface Knowledge {
  id: number;
  title: string;
  category: string;
  tags: string[];
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
  // #29C/29D/29E：旧数据可能没有这些列，读侧按可选处理。
  reason?: string;
  company?: string;
  job_id?: number | null;
  summary?: string;
  key_points?: string[];
}

export interface KnowledgePayload {
  title: string;
  category: string;
  tags: string[];
  content: string;
  source: string;
  reason?: string;
  company?: string;
  job_id?: number | null;
  summary?: string;
  key_points?: string[];
}

/**
 * 知识库列表行摘要（RF-08 分页端点 `GET /api/knowledge/page` 专用）。
 *
 * **不含 `content` 全文**：正文是 Markdown 长文，列表只带 `content_excerpt`（≤200 字）
 * 供卡片预览；回看/编辑单条时走既有详情端点 `getKnowledge(id)` 拿全文。
 */
export interface KnowledgeSummary {
  id: number;
  title: string;
  category: string;
  tags: string[];
  source: string;
  content_excerpt: string;
  created_at: string;
  updated_at: string;
  // #29C/29D/29E：列表卡片直接显示（旧数据可能缺失 → 读侧用 ?? "" 兜底）。
  reason?: string;
  company?: string;
  job_id?: number | null;
  summary?: string;
  key_points?: string[];
}

/** 全库标签聚合（`GET /api/knowledge/tags`）：去重排序，「标签筛选」下拉的数据源。 */
export interface KnowledgeTagList {
  tags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// #29C/29D/29E/29F/29A：意图字段、关联实体、蒸馏结果与检索响应。
// 这些字段在后端 0014 迁移后由 /api/knowledge 返回；旧数据为空串/空数组，读侧一律
// 按"可选"处理（不要因为一条老数据缺字段就整页崩掉）。
// ─────────────────────────────────────────────────────────────────────────────

/** 「我为什么记这条」：一句话（≤120 字，29C 列表卡片直接显示）。 */
export type KnowledgeReason = string;

/** #29D：与一家公司 / 一条岗位相关的知识（面试页、岗位详情共用）。 */
export interface KnowledgeRelated {
  total: number;
  items: KnowledgeSummary[];
}

/** #29A 混合检索的一条命中：只给定位与摘要，正文仍走 getKnowledge(id)。 */
export interface KnowledgeSearchHit {
  id: number;
  title: string;
  snippet: string;
  score: number;
  matched_heading: string;
  used_vector: boolean;
}

/** #29A 检索结果 + 诊断（哪一路命中多少、是否回退关键词）。 */
export interface KnowledgeSearchOut {
  items: KnowledgeSearchHit[];
  keyword_count: number;
  vector_count: number;
  fallback_reason: string;
}

/** #29F 复习提醒候选：长期没更新的条目（每周最多提示一次由前端去重）。 */
export interface KnowledgeReviewPrompt {
  count: number;
  items: KnowledgeSummary[];
}

/** 内置分类，与后端 KNOWLEDGE_CATEGORIES 一致；接口还会返回用户用过的自定义分类。 */
export const KNOWLEDGE_CATEGORIES = [
  "面经",
  "简历技巧",
  "求职策略",
  "面试问答",
  "公司信息",
  "行业知识",
  "其他",
] as const;
