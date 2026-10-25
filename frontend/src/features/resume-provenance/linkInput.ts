// SPDX-License-Identifier: Apache-2.0
/**
 * 建立来源关联的**纯请求构造**（W12 / P1-06，be-prov 冻结契约）。
 *
 * 新契约 `POST /api/provenance/links` 只引用已有 `source_id`（不再内联 upsert 来源），
 * 所以前端只需要把"目标块 + 选中的来源（可带修订）"拼成请求；来源本身的创建/列表
 * 由 `/api/provenance/sources` 负责。
 *
 * 本文件不请求、不读 React：可单测，避免在弹窗里手拼字段。
 */
import type { SourceLinkCreateRequest } from "./types";

/** 目标块定位（至少一项非空；后端负责按 id 现算路径）。 */
export interface LinkTargetInput {
  object_id?: string | null;
  point_id?: string | null;
  path?: string | null;
  field?: string | null;
}

/** 目标块是否可提交（空定位 = 面板应禁用提交）。 */
export function hasLinkTarget(target: LinkTargetInput | null | undefined): boolean {
  if (!target) return false;
  return Boolean(target.object_id || target.point_id || target.path);
}

/** 去掉空串/空白，只保留后端 schema 接受的字段（不把 undefined 发出去）。 */
function cleanTarget(target: LinkTargetInput): LinkTargetInput {
  const cleaned: LinkTargetInput = {};
  if (target.object_id) cleaned.object_id = target.object_id;
  if (target.point_id) cleaned.point_id = target.point_id;
  if (target.path) cleaned.path = target.path;
  if (target.field) cleaned.field = target.field;
  return cleaned;
}

/**
 * 目标块 + 来源 + 可选修订 → POST /api/provenance/links 的请求体。
 * `sourceRevisionId` 为空 = 关联该来源的最新修订。
 */
export function buildSourceLinkRequest(
  resumeId: number,
  sourceId: number,
  target: LinkTargetInput,
  sourceRevisionId?: number | null,
): SourceLinkCreateRequest {
  const request: SourceLinkCreateRequest = {
    resume_id: resumeId,
    source_id: sourceId,
    ...cleanTarget(target),
  };
  if (typeof sourceRevisionId === "number" && sourceRevisionId > 0) {
    request.source_revision_id = sourceRevisionId;
  }
  return request;
}

/** 目标块的展示文本：优先用户可核对的 data-resume-path。 */
export function targetLabel(target: LinkTargetInput | null | undefined): string {
  if (!target) return "";
  return target.path || target.object_id || target.point_id || "";
}
