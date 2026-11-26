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
  /**
   * 是否收藏（T28，迁移 0031）。
   *
   * 三个收藏/备注字段是**后加的可选字段**：后端 `brief_of` 每次都会填（缺省 false /
   * null / ""），但仓库里有些"局部 DTO"与测试夹具是在这三列之前写的，它们描述的仍是
   * 合法的外部简历（只是没提收藏）。声明成必填会让那些夹具整片报类型错，而它们并不
   * 影响运行——所以读侧一律归一：`Boolean(item.favorite)`、`item.note ?? ""`。
   */
  favorite?: boolean;
  /** 收藏时刻；null / 缺省 = 从没收藏过（取消收藏时清回 null）。 */
  favorited_at?: string | null;
  /** 用户备注（"这份是给甲方的那版"）。空串 / 缺省 = 没写，界面据此不渲染备注行。 */
  note?: string;
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

/**
 * 列表可排序字段（与后端 `ExternalResumeSortKey` 逐字一致）。
 *
 * `text_chars` 没有独立的列头（字数在文件名副行里），只能由 URL 指定——保留它是为了
 * 让 `?sort=text_chars` 这类深链与将来的「哪份写得最多」入口不必再改协议。
 */
export type ExternalResumeSortKey =
  "name" | "job_title" | "created_at" | "updated_at" | "text_chars";

/** 排序方向（与后端 `ExternalResumeSortOrder` 逐字一致）。 */
export type ExternalResumeSortOrder = "asc" | "desc";

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
  params: {
    keyword?: string;
    job_id?: number;
    /**
     * 与 `job_id` 组合时同时返回「本岗位的」与「通用的」（`job_id IS NULL`）外部简历。
     *
     * T6 起求职进度的「使用的简历」要这个范围：内部简历那一组走的是
     * `GET /api/resumes?include_general=true`（同一口径），两组范围不一致的话，
     * 同一个下拉里"为什么通用简历只出现在一组"就没法解释了。
     */
    include_general?: boolean;
    page?: number;
    page_size?: number;
    /** 服务端排序（T09）：字段 + 方向分开传，默认 `created_at desc`（不传即默认）。 */
    sort?: ExternalResumeSortKey;
    order?: ExternalResumeSortOrder;
  } = {},
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

/**
 * 收藏 / 取消收藏（T28）。
 *
 * 走服务端的唯一写入口（`services/favorites.update_favorite`）：那里用 Core UPDATE 把
 * `updated_at` 列自身写回 SET 子句，抑制 `onupdate`。前端**不能**把它当成"改一下字段"
 * 顺手塞进 `updateExternalResume`——那正是 R2「点星星跳行」的入口。
 */
export function setExternalResumeFavorite(
  id: number,
  favorite: boolean,
): Promise<ExternalResumeDetail> {
  return request(`/external-resumes/${id}/favorite`, {
    method: "PATCH",
    body: JSON.stringify({ favorite }),
  });
}

/** 写备注（空串 = 清空）。备注是编辑，服务端会正常刷新 `updated_at`。 */
export function setExternalResumeNote(id: number, note: string): Promise<ExternalResumeDetail> {
  return request(`/external-resumes/${id}/note`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
}

/** 文本级检查（纯规则、不调模型、没有总分）；关联岗位时附关键词覆盖。 */
export function getExternalResumeAnalysis(id: number): Promise<ExternalResumeAnalysis> {
  return request(`/external-resumes/${id}/analysis`, { budget: "task" });
}

/**
 * 原件 raw 直链：PDF 用 pdf.js 取字节渲染，其余格式走下载。
 *
 * 给 `revisionId` 时返回**那一版**的原件（后端 `GET /{id}/file?revision_id=` 已支持），
 * 历史版本行的「预览 / 下载」都走同一个端点，不必为"看一版旧文件"再开接口。
 *
 * 给 `download` 时是「导出原件」（T28）：后端只改 `Content-Disposition: attachment`，
 * 文件名取上传时的原始名、字节原样——所以扩展名与内容都是用户当初交上来的那份。
 * 默认 `false` 保持既有预览链路不变（inline 才能喂给 pdf.js / img）。
 */
export function externalResumeFileUrl(id: number, revisionId?: number, download = false): string {
  const base = `/api/external-resumes/${id}/file`;
  const params = new URLSearchParams();
  if (revisionId != null) params.set("revision_id", String(revisionId));
  if (download) params.set("download", "true");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

// ── 应用内编辑（#5）──────────────────────────────────────────────
//
// 三组接口对应详情抽屉里「编辑」「历史版本」两个页签：
// `blocks` 读可改的文本块，`edit` 改一块并**另存新版本**，`revisions` 读/恢复历史。
//
// 契约要点（与后端 `schemas/external_resume.py` 逐字对齐）：
// - `kind` 只有三种；`docx` / `text` 没有纸面坐标，几何字段恒为 0、`page` 恒为 0。
// - `edit` 与 `restore` 都返回**整份新详情**：界面不需要自己猜字数与「有无文字」。
// - `overflow` / `scaled` / `shifted` 是"这次改字发生了什么"，只用于展示提示与
//   「下移下方内容」按钮；不改任何几何。

/** 编辑单元所在的文件格式（决定界面画热区还是段落列表）。 */
export type ExternalResumeKind = "pdf" | "docx" | "text";

/** 一个可点选的编辑单元：PDF 是文本块，DOCX 是段落，TXT/MD 是整篇。 */
export interface ExternalResumeBlock {
  block_id: string;
  /** 1 基页码；`docx` / `text` 恒为 0（不分页）。 */
  page: number;
  text: string;
  editable: boolean;
  /** 不可编辑的原因码（可编辑时为空串），中文解释由前端映射。 */
  reason: string;
  /** PDF 纸面坐标，**原点在左下角**，单位 pt；docx / text 恒为 0。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 字号（pt）；docx / text 恒为 0。 */
  size: number;
  /** 行距（pt）；docx / text 恒为 0。 */
  leading: number;
  /** `left` / `center` / `right` / `justify`（原块的对齐方式，回写时沿用）。 */
  align: string;
}

/** 一份外部简历的编辑视图：格式 + 页面尺寸 + 编辑单元 + 警告。 */
export interface ExternalResumeBlocks {
  resume_id: number;
  kind: ExternalResumeKind;
  page_count: number;
  /** 页宽 / 页高（pt）；docx / text 恒为 0。 */
  page_width: number;
  page_height: number;
  blocks: ExternalResumeBlock[];
  warnings: string[];
}

/** 一次改字的入参。`shift_below` 只在用户点「下移下方内容」时传。 */
export interface ExternalResumeEditInput {
  block_id: string;
  text: string;
  /** 把该块下方所有内容整体下移多少 pt（0 = 不动，与 Acrobat 的文本框行为一致）。 */
  shift_below?: number;
}

/** 历史版本列表的一行（不含正文：字节在各 `user_file` 里）。 */
export interface ExternalResumeRevision {
  id: number;
  file_id: number;
  text_chars: number;
  has_text: boolean;
  /** `upload` / `edit` / `restore`（协议值，界面按它取译文）。 */
  source: string;
  created_at: string;
  /** 是否当前版本（`file_id` 与简历当前 `file_id` 相同）。 */
  current: boolean;
}

export interface ExternalResumeRevisions {
  resume_id: number;
  items: ExternalResumeRevision[];
  total: number;
}

/** 编辑结果：刷新后的详情 + 新版本 + 这次改字的几何变化。 */
export interface ExternalResumeEditResult {
  resume: ExternalResumeDetail;
  revision: ExternalResumeRevision;
  kind: ExternalResumeKind;
  block_id: string;
  page: number;
  /** 块高变化（pt，> 0 = 变高）；docx / text 恒为 0。 */
  delta_pt: number;
  /** 新文字压到了下方内容。 */
  overflow: boolean;
  /** 超出原块宽度，已按比例缩小字号。 */
  scaled: boolean;
  /** 这次是否执行了「下移下方内容」。 */
  shifted: boolean;
  lines_before: number;
  lines_after: number;
  warnings: string[];
}

/** 恢复历史版本的结果：恢复后的详情 + 新写入的那条版本。 */
export interface ExternalResumeRestoreResult {
  resume: ExternalResumeDetail;
  revision: ExternalResumeRevision;
  warnings: string[];
}

/**
 * 读这份外部简历能改哪些块 / 段落。
 *
 * 能力探测失败（扫描件 / 转曲 / 加密 / 表单 / 旋转页 / 不支持的后缀）一律 422，
 * `detail` 是面向用户的完整句子；界面直接展示并引导下载后本地改。
 */
export function getExternalResumeBlocks(id: number): Promise<ExternalResumeBlocks> {
  return request(`/external-resumes/${id}/blocks`, { budget: "task" });
}

/**
 * 把某一块改成新文字，**另存为新版本**（绝不覆盖原件）。
 *
 * 422 = 这一块不能改 / 块已不存在 / 新文字放不下；404 = 简历或它当前的文件已不存在。
 * 预算用 `task`：服务端要解析 content stream、删旧算子、重排覆盖层，15s 会误超时。
 */
export function editExternalResumeBlock(
  id: number,
  input: ExternalResumeEditInput,
): Promise<ExternalResumeEditResult> {
  return request(`/external-resumes/${id}/edit`, {
    method: "POST",
    body: JSON.stringify(input),
    budget: "task",
  });
}

/** 历史版本（时间倒序）：时间、字数、有无文字、来源。 */
export function listExternalResumeRevisions(id: number): Promise<ExternalResumeRevisions> {
  return request(`/external-resumes/${id}/revisions`);
}

/** 恢复到某个历史版本：**再写一条** `source=restore` 的新版本，不改写历史。 */
export function restoreExternalResumeRevision(
  id: number,
  revisionId: number,
): Promise<ExternalResumeRestoreResult> {
  return request(`/external-resumes/${id}/revisions/${revisionId}/restore`, {
    method: "POST",
    budget: "task",
  });
}

/** 某一版历史版本的正文（T12 的「对比」与"看这一版"用）。 */
export interface ExternalResumeRevisionText {
  revision_id: number;
  text: string;
  text_chars: number;
  has_text: boolean;
}

/**
 * 取某一版历史版本的**正文**。
 *
 * 历史版本列表里不带正文（同一段话在库里只存一份），所以这一条要按需再请求一次：
 * 后端会从那一版自己的文件重新提取（一次 pypdf / docx 解析，15s 预算够）。
 * 因此「对比」与"看这一版"都是懒加载——不点就不花这个成本。
 */
export function getExternalResumeRevisionText(
  id: number,
  revisionId: number,
): Promise<ExternalResumeRevisionText> {
  return request(`/external-resumes/${id}/revisions/${revisionId}/text`, { budget: "task" });
}
