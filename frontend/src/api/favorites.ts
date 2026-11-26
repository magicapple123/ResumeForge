// SPDX-License-Identifier: Apache-2.0
/**
 * 收藏页「简历」页签的数据源（T31）：内部简历 + 外部简历**一次取全**。
 *
 * 为什么不再复用 `listResumes({favorite: true})`：那个接口只认识 `resume_record`
 * （内部简历），外部简历自 T28 起也能收藏，却因此进不了收藏页。合并与排序必须在
 * 服务端做（`GET /api/favorites`，见 `backend/app/services/favorites_resumes.py`
 * 的模块说明）——前端拼两次请求会把两批分页结果叠在一起，`total` 会变成两个总数之和，
 * 「按收藏时间倒序」也不再成立。
 *
 * `kind` 是每一行**自带的**字段，不靠 id 区间猜：两张表的 id 各自从 1 开始、会撞号
 * （见 `types/resumeRef.ts`）。`ref`（`internal:12` / `external:7`）与
 * `decodeResumeRef` 同一套写法，可直接当稳定 key 或进 URL。
 */
import type { Page } from "../types";
import { buildQuery, request } from "./client";

/** 简历收藏行的来源：内部（`resume_record`）/ 外部（`external_resume`）。 */
export type FavoriteResumeKind = "internal" | "external";

/** 收藏页的一行：两张表的并集字段（各自没有的字段留空，见后端 schema 注释）。 */
export interface FavoriteResumeItem {
  kind: FavoriteResumeKind;
  /** 在**自己那张表**里的 id；两种 kind 共享数字空间，不能混用。 */
  id: number;
  /** 复合引用 `internal:12` / `external:7`。 */
  ref: string;
  /** 展示名：内部 = 简历标题；外部 = 文件名。 */
  title: string;
  job_title: string;
  company: string;
  /** 内部简历的来源（`ai` / `manual`）；外部简历恒为空串。 */
  source: string;
  /** 外部简历原件的 MIME（格式徽标的数据源）；内部简历恒为空串。 */
  mime: string;
  /** 外部简历当前文件 id（预览原件用）；内部简历为 `null`。 */
  file_id: number | null;
  note: string;
  /** 外部简历的提取字数；内部简历为 `null`。 */
  text_chars: number | null;
  /** 外部简历有没有文字层；内部简历为 `null`。 */
  has_text: boolean | null;
  favorite: boolean;
  favorited_at: string | null;
  favorited_at_estimated: boolean;
  created_at: string;
  updated_at: string;
}

/** `GET /api/favorites` 的查询参数（与后端 `list_favorites` 一一对应）。 */
export interface FavoriteResumeParams {
  /** `all`（默认）/ `internal` / `external`。 */
  kind?: "all" | FavoriteResumeKind;
  keyword?: string;
  page?: number;
  page_size?: number;
}

/**
 * 取收藏的简历（两种 kind 合并后按收藏时间倒序分页）。
 *
 * @param params 过滤与分页参数；空对象等价于「第一页、每页 20」。
 * @returns 当前页的行与**合并后**的总数。
 */
export function listFavoriteResumes(
  params: FavoriteResumeParams = {},
): Promise<Page<FavoriteResumeItem>> {
  return request(`/favorites${buildQuery(params)}`);
}
