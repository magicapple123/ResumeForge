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
}

export interface KnowledgePayload {
  title: string;
  category: string;
  tags: string[];
  content: string;
  source: string;
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
}

/** 全库标签聚合（`GET /api/knowledge/tags`）：去重排序，「标签筛选」下拉的数据源。 */
export interface KnowledgeTagList {
  tags: string[];
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
