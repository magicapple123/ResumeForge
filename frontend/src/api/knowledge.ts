// SPDX-License-Identifier: Apache-2.0
/** 知识库接口：条目的增删改查 + #29 的筛选/检索/关联/复习/导出。 */
import type {
  Knowledge,
  KnowledgePayload,
  KnowledgeRelated,
  KnowledgeReviewPrompt,
  KnowledgeSearchOut,
  KnowledgeSummary,
  KnowledgeTagList,
} from "../types";
import type { Page } from "../types/common";
import { buildQuery, getFilenameFromDisposition, request, requestRaw } from "./client";
/**
 * 旧版全量列表（P1-6）：现返回**摘要行**（content_excerpt ≤200 字），与后端
 * `_knowledge_summary` 口径一致——正文是 Markdown 长文，列表不再整库搬运。
 * 新代码请用 `listKnowledgePage`；回看/编辑全文走 `getKnowledge(id)`。
 */
export function listKnowledge(
  params: { q?: string; category?: string } = {},
): Promise<KnowledgeSummary[]> {
  return request(`/knowledge${buildQuery(params)}`);
}

/**
 * 分页列出知识库条目（RF-08）：过滤与排序与旧列表一致。旧端点一次返回**全量**含正文，
 * 这里列表行只带 `content_excerpt`（≤200 字）摘要；回看/编辑全文走 `getKnowledge(id)`。
 * `tag` 为可选的精确标签筛选（与 q/category 可组合，分页前过滤、total 为筛选后集合）。
 */
export function listKnowledgePage(
  params: {
    q?: string;
    category?: string;
    tag?: string;
    /** #29D：按关联公司精确筛选。 */
    company?: string;
    /** #29G：只看未分类（分类为空串）。 */
    uncategorized?: boolean;
  } = {},
  page: number,
  pageSize: number,
): Promise<Page<KnowledgeSummary>> {
  // buildQuery 会跳过空值：tag 为空串/undefined 时不会拼进查询串；
  // uncategorized 只在 true 时下发（false 与不传同义，别把 "false" 字符串发给后端）。
  const query = {
    q: params.q,
    category: params.category,
    tag: params.tag,
    company: params.company,
    uncategorized: params.uncategorized || undefined,
    page,
    page_size: pageSize,
  };
  return request(`/knowledge/page${buildQuery(query)}`);
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

/** 批量移入回收站（软删除）：与简历批量删除同一口径，后端缺失任一 id 即整体 404。 */
export function batchDeleteKnowledge(knowledgeIds: number[]): Promise<{ deleted: number }> {
  return request("/knowledge/batch-delete", {
    method: "POST",
    body: JSON.stringify({ knowledge_ids: knowledgeIds }),
  });
}

/** #29D 已用过的公司名（字典序）：公司筛选下拉的数据源。 */
export function listKnowledgeCompanies(): Promise<string[]> {
  return request("/knowledge/companies");
}

/**
 * #29D 与一家公司 / 一条岗位相关的知识（面试页「这家公司面经 N 条」、岗位详情
 * 「相关知识 N 条」共用）。company 与 job_id 都是精确匹配，二者 OR；都不传返回空。
 */
export function getKnowledgeRelated(
  params: { company?: string; job_id?: number; limit?: number } = {},
): Promise<KnowledgeRelated> {
  return request(`/knowledge/related${buildQuery(params)}`);
}

/**
 * #29A 混合检索（关键词 + 向量；向量不可用时后端自动回退关键词并在
 * fallback_reason 里说明）。只返回定位与摘要，正文仍走 getKnowledge(id)。
 */
export function searchKnowledge(params: {
  q: string;
  limit?: number;
  company?: string;
}): Promise<KnowledgeSearchOut> {
  return request(`/knowledge/search${buildQuery(params)}`);
}

/** #29F 复习提醒候选（长期没更新的条目；每周最多提示一次由前端按周去重）。 */
export function getKnowledgeReviewPrompt(
  params: { stale_days?: number; limit?: number } = {},
): Promise<KnowledgeReviewPrompt> {
  return request(`/knowledge/review-prompt${buildQuery(params)}`);
}

/** #29B 知识回流来源：前端只传来源与 id，正文由服务端从业务数据生成。 */
export type KnowledgeCaptureSource = "interview_report" | "apply_failure" | "resume_diagnosis";

export interface KnowledgeFromSourceResult {
  id: number;
  title: string;
  category: string;
  source: string;
  /** false = 知识库里已有同内容条目，没有重复创建。 */
  created: boolean;
}

/**
 * #29B 三个回流入口共用：面试复盘 / 投递失败 / 简历诊断 → 一条知识条目。
 *
 * 只传来源类型与来源 id：正文、标题、分类、关联公司都由服务端生成，前端不拼整篇正文
 * （否则会与业务数据漂移，也无法保证字段完整）。
 */
export function createKnowledgeFromSource(
  source: KnowledgeCaptureSource,
  sourceId: number,
): Promise<KnowledgeFromSourceResult> {
  return request("/knowledge/from-source", {
    method: "POST",
    body: JSON.stringify({ source, source_id: sourceId }),
  });
}

/**
 * #29 Markdown 目录导出：GET /api/knowledge/export → zip。
 *
 * 返回解包后的 Blob 与响应头里的下载名（服务端用 filename* UTF-8 编码，中文不乱码）；
 * 调 `downloadBlob` 直接落盘。空知识库时后端 404，`requestRaw` 会抛 ApiError（detail 可直接展示）。
 */
export async function exportKnowledgeMarkdown(): Promise<{ blob: Blob; filename: string }> {
  const response = await requestRaw("/knowledge/export", { budget: "export" });
  const filename =
    getFilenameFromDisposition(response.headers.get("content-disposition")) ??
    "knowledge-export.zip";
  return { blob: await response.blob(), filename };
}
