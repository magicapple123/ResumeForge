// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的真实 API 出口（W17-BE 已就绪：`/api/resume-phrases`，迁移 0056）。
 *
 * 全部本地操作：不调用模型、不自动外发；正文不写日志（后端契约）。
 * 删除是**软删进回收站第 17 类**，恢复走既有 `api/trash.restoreTrashItem("phrase", id)`。
 */
import { request } from "../../api/client";
import type {
  PhraseInsertOut,
  PhraseInsertPayload,
  PhraseInPayload,
  PhraseListOut,
  PhraseUpdateOut,
  PhraseUpdatePayload,
  ResumePhrase,
} from "./types";

const BASE = "/resume-phrases";

/** 列表：服务端只做分页与粗筛；面板内的即时筛选仍走本地纯函数。 */
export function listPhrases(
  params: {
    kind?: string;
    language?: string;
    tag?: string;
    keyword?: string;
    limit?: number;
    cursor?: number | null;
  } = {},
): Promise<PhraseListOut> {
  const query = new URLSearchParams();
  for (const key of ["kind", "language", "tag", "keyword"] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", String(params.cursor));
  const suffix = query.toString();
  return request(BASE + (suffix ? "?" + suffix : ""));
}

/** 新建一条资产。 */
export function createPhrase(payload: PhraseInPayload): Promise<ResumePhrase> {
  return request(BASE, { method: "POST", body: JSON.stringify(payload) });
}

/** 更新一条资产（只提交给出的字段）；响应带 previous 旧快照（be-prov 契约）。 */
export function updatePhrase(
  phraseId: number,
  payload: PhraseUpdatePayload,
): Promise<PhraseUpdateOut> {
  return request(BASE + "/" + phraseId, { method: "PATCH", body: JSON.stringify(payload) });
}

/** 软删（进回收站，可恢复）。 */
export function deletePhrase(phraseId: number): Promise<void> {
  return request(BASE + "/" + phraseId, { method: "DELETE" });
}

/**
 * 把简历里选中一句收藏成资产；path 解析不到服务端会 422（不猜）。
 * `jobTags` 可选（be-prov 契约新增）：在收藏入口直接打岗位标签。
 */
export function collectPhrase(
  resumeId: number,
  path: string,
  jobTags?: string[],
): Promise<ResumePhrase> {
  const body: Record<string, unknown> = { resume_id: resumeId, path };
  if (jobTags && jobTags.length > 0) body.job_tags = jobTags;
  return request(BASE + "/collect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 插入简历：新 object_id/point_id + 条件写；失败/409 时正文不改。 */
export function insertPhrase(
  phraseId: number,
  payload: PhraseInsertPayload,
): Promise<PhraseInsertOut> {
  return request(BASE + "/" + phraseId + "/insert", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
