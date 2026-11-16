// SPDX-License-Identifier: Apache-2.0
/** 公司与岗位背景调研接口（T07）。 */
import { request } from "./client";

/** 一张资料卡片。字段由后端保证齐全（空值就是空串 / null，不会是 undefined）。 */
export interface ResearchCard {
  /** `official` 官网 / `news` 近期新闻 / `overview` 公司介绍。 */
  kind: "official" | "news" | "overview";
  title: string;
  url: string;
  snippet: string;
  /** 站点名；后端在缺失时用主机名兜底，所以这里一定非空。 */
  site_name: string;
  /** 站点图标绝对 URL；空串表示没有（前端不渲染 img，也不去猜 favicon）。 */
  site_icon: string;
  /** 发布日期 `YYYY-MM-DD`；空串表示来源没给日期。 */
  date: string;
  /** 权威度分数；来源没给时为 null。 */
  authority: number | null;
  /** 权威度 ≥ 4 才为 true（「极权威」标）。 */
  authority_high: boolean;
}

/** 简报里的一条编号来源，`number` 与正文里的 `[n]` 一一对应。 */
export interface ResearchSource {
  number: number;
  title: string;
  url: string;
}

/** 联网简报。`status === "failed"` 时 `reason` 有值、`markdown` 为空。 */
export interface ResearchBrief {
  /** `skipped` = 本次没有请求这一路（`parts` 白名单），不是失败。 */
  status: "ok" | "failed" | "skipped";
  reason: string;
  /**
   * 失败分类（I-22）：`unauthorized` 去设置配置 Key、`insufficient_balance` 查余额、
   * `rate_limited` 稍后重试、`upstream` 其他上游问题。成功时为空串 / 缺失。
   */
  reason_code?: "unauthorized" | "insufficient_balance" | "rate_limited" | "upstream" | "";
  markdown: string;
  sources: ResearchSource[];
  deep: boolean;
  tool_calls: number;
  query_terms: number;
  billed_searches: number;
  fetched_pages: number;
  tool_call_budget: number;
  tool_budget_exceeded: boolean;
  elapsed_ms?: number;
}

/** 本轮用量。**不折算金额**，只回答"搜了几次、花了多久"。 */
export interface ResearchUsage {
  deep: boolean;
  card_queries: number;
  brief_query_terms: number;
  brief_tool_calls: number;
  search_calls: number;
  tool_call_budget: number;
  elapsed_ms: number;
}

export interface CompanyResearchResult {
  company: string;
  role: string;
  deep: boolean;
  cards: ResearchCard[];
  brief: ResearchBrief;
  sources: ResearchSource[];
  /** 降级说明（某条查询失败、简报没做出来等），已去重。 */
  notes: string[];
  usage: ResearchUsage;
  /** I-21：本次结果落库后的知识条目摘要（落库失败或无可落库内容时为 null）。 */
  knowledge_entry?: ResearchEntrySummary | null;
}

export interface CompanyResearchInput {
  company: string;
  role?: string;
  jd?: string;
  deep?: boolean;
  /** I-21：从岗位详情发起时带上，落库的知识条目会挂到该岗位。 */
  job_id?: number;
  /** I-23：只跑指定的路；不传 = 两条都跑。简报失败时用它只重跑简报，不重复搜卡片。 */
  parts?: Array<"cards" | "brief">;
}

/** 这家公司最近一次调研的摘要（I-21）：只有元信息，正文在知识库里读。 */
export interface ResearchEntrySummary {
  id: number;
  title: string;
  company: string;
  reason: string;
  updated_at: string | null;
}

/** 读「最近一次调研」；没有返回 `null`。 */
export function latestCompanyResearch(company: string): Promise<{ entry: ResearchEntrySummary | null }> {
  return request(`/research/company/latest?company=${encodeURIComponent(company)}`);
}

/**
 * 跑一次调研。
 *
 * 请求预算用 `analysis` 档（180s）：深度调研在服务端要串多轮搜索与读页面，
 * 官方演示里单次 5–11 秒，极端情况更久；`default` 的 15 秒必然误超时。
 */
export function researchCompany(input: CompanyResearchInput): Promise<CompanyResearchResult> {
  return request("/research/company", {
    method: "POST",
    body: JSON.stringify(input),
    budget: "analysis",
  });
}
