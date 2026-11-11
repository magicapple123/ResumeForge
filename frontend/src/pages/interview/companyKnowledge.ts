// SPDX-License-Identifier: Apache-2.0
/**
 * #29D 面试页「这家公司面经 N 条」的数据入口。
 *
 * 复用后端 `GET /api/knowledge/related`（company / job_id 精确匹配，OR）。本页只按
 * **公司名**查：面试会话的 company 是建场时的岗位快照，用户点进去要按公司看面经。
 * `total` 就是"面经 N 条"的 N（后端精确匹配后的全量，不是本页 items.length）。
 *
 * api 层（`api/knowledge.ts` 的 `getKnowledgeRelated`）与类型由 w2 的 #29 页面 UI
 * 一并维护——这里只做"面试页需要的那一种查询"的薄适配，避免两处各写一份请求。
 */

import { getKnowledgeRelated } from "../../api/knowledge";
import type { KnowledgeRelated } from "../../types";

/** 本页需要的最小形状：total 用于「N 条」，items 只取列表要显示的 id/title。 */
export type CompanyKnowledgeRelated = Pick<KnowledgeRelated, "total"> & {
  items: Array<{ id: number; title: string }>;
};

/** 面试房间一次最多取几条标题（后端默认 limit=5）。 */
export const COMPANY_KNOWLEDGE_LIMIT = 5;

/** 按公司名查知识库条目摘要。 */
export function getCompanyKnowledgeRelated(company: string): Promise<CompanyKnowledgeRelated> {
  return getKnowledgeRelated({ company: company.trim(), limit: COMPANY_KNOWLEDGE_LIMIT });
}

/**
 * 知识库页的公司筛选链接（w2 确认：参数名 company、精确匹配、可与其他筛选组合）。
 * 公司名必须 encodeURIComponent——中文/空格/斜杠都要能安全进 URL。
 */
export function knowledgeCompanyHref(company: string): string {
  return `/knowledge?company=${encodeURIComponent(company.trim())}`;
}
