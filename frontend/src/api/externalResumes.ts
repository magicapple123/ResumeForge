// SPDX-License-Identifier: Apache-2.0
/** 外部简历接口：上传 / 列表 / 详情 / 改名与关联岗位 / 软删 / 原件 / 文本检查。 */
import { buildQuery, request } from "./client";

/** 检查项 key 是**协议值**（与后端 schemas/external_resume.py 的 ANALYSIS_CHECK_KEYS 一致），
 * 前端按它取语言包文案；不随语言变。 */
export type ExternalResumeCheckKey =
  "placeholder" | "quantification" | "contact" | "length" | "weak_wording" | "keywords";

export interface ExternalResumeItem {
  id: number;
  file_id: number;
  name: string;
  /** 原件的 MIME（由 user_file 带出）：决定"原件"标签用 iframe 预览还是下载。 */
  mime: string;
  text_chars: number;
  /** 上传时是否提取到文字。false = 扫描件 / 无文字层：原件可预览，但不能做文本检查、
   * 也不能直接"用于面试"（面试材料正文要求非空）。 */
  has_text: boolean;
  job_id: number | null;
  job_title: string;
  created_at: string;
  updated_at: string;
  /** 上传接口的警告（如"没有文字层"）；列表/详情默认为空数组。 */
  warnings: string[];
}

export interface ExternalResumeDetail extends ExternalResumeItem {
  text: string;
}

export interface ExternalResumeList {
  items: ExternalResumeItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ExternalResumeUpdateInput {
  name?: string;
  /** 传 null 表示取消关联（后端用 model_fields_set 区分"没传"与"传 null"）。 */
  job_id?: number | null;
}

export interface AnalysisHit {
  line: number;
  text: string;
}

export interface KeywordCoverage {
  target: string[];
  matched: string[];
  missing: string[];
  coverage_ratio: number;
}

export interface AnalysisCheck {
  key: ExternalResumeCheckKey;
  count: number;
  ratio: number | null;
  sample_size: number;
  items: AnalysisHit[];
  keywords: KeywordCoverage | null;
}

export interface ExternalResumeAnalysis {
  resume_id: number;
  text_chars: number;
  line_count: number;
  estimated_pages: number;
  has_text: boolean;
  checks: AnalysisCheck[];
  warnings: string[];
}

export function listExternalResumes(
  params: { keyword?: string; job_id?: number; page?: number; page_size?: number } = {},
): Promise<ExternalResumeList> {
  return request(`/external-resumes${buildQuery(params)}`);
}

export function getExternalResume(id: number): Promise<ExternalResumeDetail> {
  return request(`/external-resumes/${id}`);
}

/**
 * 上传一份外部简历（multipart）。
 *
 * 服务端**上传即本地提取**文本、不调视觉模型；扫描件会带 `has_text: false` 与警告。
 * 上传档预算（10 分钟）：解析 PDF/docx 是服务端 CPU 活，不是网络慢。
 */
export function uploadExternalResume(
  file: File,
  options: { name?: string; jobId?: number | null } = {},
): Promise<ExternalResumeDetail> {
  const form = new FormData();
  form.append("file", file);
  if (options.name) form.append("name", options.name);
  if (options.jobId != null) form.append("job_id", String(options.jobId));
  return request("/external-resumes", { method: "POST", body: form, budget: "upload" });
}

export function updateExternalResume(
  id: number,
  input: ExternalResumeUpdateInput,
): Promise<ExternalResumeDetail> {
  return request(`/external-resumes/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

/** 软删进回收站；原件与 user_file 登记都保留（恢复见 /api/trash）。 */
export function deleteExternalResume(id: number): Promise<void> {
  return request(`/external-resumes/${id}`, { method: "DELETE" });
}

/** 文本级检查（纯规则、不调模型、没有总分）；关联岗位时附关键词覆盖。 */
export function getExternalResumeAnalysis(id: number): Promise<ExternalResumeAnalysis> {
  return request(`/external-resumes/${id}/analysis`, { budget: "task" });
}

/** 原件 raw 直链：PDF 可嵌 iframe，其余格式走下载。 */
export function externalResumeFileUrl(id: number): string {
  return `/api/external-resumes/${id}/file`;
}
