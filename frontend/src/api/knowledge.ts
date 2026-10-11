/** 知识库接口：条目的增删改查。 */
import type { Knowledge, KnowledgePayload, KnowledgeSummary, KnowledgeTagList } from "../types";
import type { Page } from "../types/common";
import { buildQuery, request } from "./client";

export function listKnowledge(
  params: { q?: string; category?: string } = {},
): Promise<Knowledge[]> {
  return request(`/knowledge${buildQuery(params)}`);
}

/**
 * 分页列出知识库条目（RF-08）：过滤与排序与旧列表一致。旧端点一次返回**全量**含正文，
 * 这里列表行只带 `content_excerpt`（≤200 字）摘要；回看/编辑全文走 `getKnowledge(id)`。
 * `tag` 为可选的精确标签筛选（与 q/category 可组合，分页前过滤、total 为筛选后集合）。
 */
export function listKnowledgePage(
  params: { q?: string; category?: string; tag?: string } = {},
  page: number,
  pageSize: number,
): Promise<Page<KnowledgeSummary>> {
  // buildQuery 会跳过空值：tag 为空串/undefined 时不会拼进查询串。
  return request(`/knowledge/page${buildQuery({ ...params, page, page_size: pageSize })}`);
}

/** 全库去重排序后的标签聚合（「标签筛选」下拉的数据源，不再依赖当前页条目）。 */
export function listKnowledgeTags(): Promise<KnowledgeTagList> {
  return request("/knowledge/tags");
}

/** 候选分类：内置分类 + 用户已用过的自定义分类。 */
export function listKnowledgeCategories(): Promise<string[]> {
  return request("/knowledge/categories");
}

export function getKnowledge(id: number): Promise<Knowledge> {
  return request(`/knowledge/${id}`);
}

export function createKnowledge(payload: KnowledgePayload): Promise<Knowledge> {
  return request("/knowledge", { method: "POST", body: JSON.stringify(payload) });
}

export function updateKnowledge(id: number, payload: KnowledgePayload): Promise<Knowledge> {
  return request(`/knowledge/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteKnowledge(id: number): Promise<void> {
  return request(`/knowledge/${id}`, { method: "DELETE" });
}
