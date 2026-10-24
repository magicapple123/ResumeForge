// SPDX-License-Identifier: Apache-2.0
/**
 * `annotations.json` sidecar v1 的**严格解析与序列化**（W18 / 契约 wave3 §4.2、§4.4）。
 *
 * 回传文件来自外部电脑，按不可信输入处理。前端解析的定位是"在发请求前就把能看出来的
 * 格式错误指给用户"，减少一次网络往返；真正的 fail-closed 九步校验仍在服务端（权限、
 * token 常数时间比对、包快照一致性、版本归属、锚点 stale 判定、去重、事务写库）。
 *
 * 前端这一步校验：大小、JSON、版本/kind、token 形状、快照哈希字段、条数上限、逐条
 * 字段与长度、包内 external_id 重复。**不**校验 share_token 与当前包是否一致（那需要
 * 服务端拿包 token 比对）。
 */
import { isObjectId } from "../resume-document/identity";
import {
  REVIEW_ANNOTATIONS_MAX,
  REVIEW_EXTERNAL_ID_MAX,
  REVIEW_PACK_KIND,
  REVIEW_PACK_MAX_BYTES,
  REVIEW_PACK_VERSION,
  REVIEW_PATH_MAX,
  REVIEW_PATH_PATTERN,
  REVIEW_QUOTED_MAX,
  REVIEW_REVIEWER_MAX,
  REVIEW_SHARE_TOKEN_PATTERN,
  REVIEW_TEXT_MAX,
  type ReviewPack,
  type ReviewPackAnnotation,
  type ReviewPackIssue,
  type ReviewPackParseResult,
} from "./types";

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function optionalString(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > max) return undefined;
  return value;
}

/** 逐条校验结果：合法给规范化批注，不合法给字段名。 */
function readAnnotation(value: unknown): { annotation: ReviewPackAnnotation } | { field: string } {
  if (!isRecord(value)) return { field: "" };
  const externalId = value.external_id;
  if (
    typeof externalId !== "string" ||
    externalId.length === 0 ||
    externalId.length > REVIEW_EXTERNAL_ID_MAX
  ) {
    return { field: "external_id" };
  }
  const objectId = value.object_id;
  if (
    objectId !== undefined &&
    objectId !== null &&
    (typeof objectId !== "string" || !isObjectId(objectId))
  ) {
    return { field: "object_id" };
  }
  const pointId = value.point_id;
  if (
    pointId !== undefined &&
    pointId !== null &&
    (typeof pointId !== "string" || !isObjectId(pointId))
  ) {
    return { field: "point_id" };
  }
  const path = value.path;
  if (path !== undefined && path !== null) {
    if (
      typeof path !== "string" ||
      path.length > REVIEW_PATH_MAX ||
      !REVIEW_PATH_PATTERN.test(path)
    ) {
      return { field: "path" };
    }
  }
  const hasObjectAnchor = typeof objectId === "string" && objectId.length > 0;
  const hasPathAnchor = typeof path === "string" && path.length > 0;
  if (!hasObjectAnchor && !hasPathAnchor) {
    // 契约 §4.2：至少要有 object_id 或 path；两者都没有的批注无法定位，也不允许
    // 让服务端"猜"（plan §D17 明确禁止按下标回退）。
    return { field: "object_id" };
  }
  const field = value.field;
  if (field !== undefined && field !== null && (typeof field !== "string" || field.length > 64)) {
    return { field: "field" };
  }
  const quoted = value.quoted_text;
  if (
    quoted !== undefined &&
    quoted !== null &&
    (typeof quoted !== "string" || quoted.length > REVIEW_QUOTED_MAX)
  ) {
    return { field: "quoted_text" };
  }
  const text = value.text;
  if (typeof text !== "string" || text.trim().length === 0 || text.length > REVIEW_TEXT_MAX) {
    return { field: "text" };
  }
  const createdAt = value.created_at;
  if (createdAt !== undefined && createdAt !== null && !isTimestamp(createdAt)) {
    return { field: "created_at" };
  }
  const annotation: ReviewPackAnnotation = { external_id: externalId, text };
  if (hasObjectAnchor) annotation.object_id = objectId as string;
  if (typeof pointId === "string") annotation.point_id = pointId;
  if (typeof path === "string") annotation.path = path;
  if (typeof field === "string") annotation.field = field;
  if (typeof quoted === "string") annotation.quoted_text = quoted;
  if (typeof createdAt === "string") annotation.created_at = createdAt;
  return { annotation };
}

/**
 * 解析 `annotations.json` 文本。**永不抛异常**：外部文件解析失败是正常路径。
 * 返回全部问题（而不是只报第一个），用户一次能改完。
 */
export function parseReviewPack(raw: string): ReviewPackParseResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, issues: [{ code: "not-json" }] };
  }
  if (utf8Bytes(raw) > REVIEW_PACK_MAX_BYTES) {
    return { ok: false, issues: [{ code: "too-large" }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, issues: [{ code: "not-json" }] };
  }
  if (!isRecord(value)) return { ok: false, issues: [{ code: "bad-format" }] };

  const issues: ReviewPackIssue[] = [];
  if (value.format_version !== REVIEW_PACK_VERSION) issues.push({ code: "bad-version" });
  if (value.kind !== REVIEW_PACK_KIND) issues.push({ code: "bad-format" });
  const shareToken = value.share_token;
  if (typeof shareToken !== "string" || !REVIEW_SHARE_TOKEN_PATTERN.test(shareToken)) {
    issues.push({ code: "bad-token" });
  }
  const packageSnapshot = value.package_snapshot_sha256;
  if (
    typeof packageSnapshot !== "string" ||
    packageSnapshot.length === 0 ||
    packageSnapshot.length > 128
  ) {
    issues.push({ code: "bad-snapshot" });
  }
  if (value.resume_snapshot_sha256 !== undefined && value.resume_snapshot_sha256 !== null) {
    const resumeSha = value.resume_snapshot_sha256;
    if (typeof resumeSha !== "string" || resumeSha.length === 0 || resumeSha.length > 128) {
      issues.push({ code: "bad-snapshot" });
    }
  }
  if (value.document_version_id !== undefined && value.document_version_id !== null) {
    const versionId = value.document_version_id;
    if (typeof versionId !== "number" || !Number.isInteger(versionId) || versionId < 1) {
      issues.push({ code: "bad-format" });
    }
  }
  const reviewer = value.reviewer;
  if (reviewer !== undefined && reviewer !== null) {
    if (typeof reviewer !== "string" || reviewer.length > REVIEW_REVIEWER_MAX) {
      issues.push({ code: "bad-reviewer" });
    }
  }
  const createdAt = value.created_at;
  if (createdAt !== undefined && createdAt !== null && !isTimestamp(createdAt)) {
    issues.push({ code: "bad-format" });
  }
  const rawAnnotations = value.annotations;
  if (!Array.isArray(rawAnnotations) || rawAnnotations.length > REVIEW_ANNOTATIONS_MAX) {
    issues.push({ code: "bad-annotations" });
    return { ok: false, issues };
  }
  const annotations: ReviewPackAnnotation[] = [];
  const seen = new Set<string>();
  rawAnnotations.forEach((item: unknown, index: number) => {
    const parsed = readAnnotation(item);
    if ("field" in parsed) {
      issues.push({ code: "bad-annotation", index, field: parsed.field });
      return;
    }
    if (seen.has(parsed.annotation.external_id)) {
      issues.push({ code: "duplicate-external-id", index });
      return;
    }
    seen.add(parsed.annotation.external_id);
    annotations.push(parsed.annotation);
  });
  if (issues.length > 0 || typeof shareToken !== "string" || typeof packageSnapshot !== "string") {
    return { ok: false, issues };
  }

  const pack: ReviewPack = {
    format_version: REVIEW_PACK_VERSION,
    kind: REVIEW_PACK_KIND,
    share_token: shareToken,
    package_snapshot_sha256: packageSnapshot,
    annotations,
  };
  const resumeSha = optionalString(value.resume_snapshot_sha256, 128);
  if (resumeSha !== undefined) pack.resume_snapshot_sha256 = resumeSha;
  if (typeof value.document_version_id === "number")
    pack.document_version_id = value.document_version_id;
  const packReviewer = optionalString(reviewer, REVIEW_REVIEWER_MAX);
  if (packReviewer !== undefined) pack.reviewer = packReviewer;
  if (typeof createdAt === "string") pack.created_at = createdAt;
  return { ok: true, pack };
}

/** 组一个批注包（模板/测试/前端导出用；真实评审包由后端分享包负责生成）。 */
export function buildReviewPack(input: {
  shareToken: string;
  packageSnapshotSha256: string;
  annotations?: readonly ReviewPackAnnotation[];
  reviewer?: string;
  resumeSnapshotSha256?: string;
  documentVersionId?: number | null;
  createdAt?: string;
}): ReviewPack {
  return {
    format_version: REVIEW_PACK_VERSION,
    kind: REVIEW_PACK_KIND,
    share_token: input.shareToken,
    package_snapshot_sha256: input.packageSnapshotSha256,
    ...(input.resumeSnapshotSha256 ? { resume_snapshot_sha256: input.resumeSnapshotSha256 } : {}),
    ...(input.documentVersionId ? { document_version_id: input.documentVersionId } : {}),
    ...(input.reviewer ? { reviewer: input.reviewer } : {}),
    ...(input.createdAt ? { created_at: input.createdAt } : {}),
    annotations: (input.annotations ?? []).map((annotation) => ({ ...annotation })),
  };
}

/** 序列化为可回传的 JSON 文本（2 空格缩进；字段顺序稳定，便于人工查看/测试断言）。 */
export function serializeReviewPack(pack: ReviewPack): string {
  return JSON.stringify(
    {
      format_version: pack.format_version,
      kind: pack.kind,
      share_token: pack.share_token,
      package_snapshot_sha256: pack.package_snapshot_sha256,
      ...(pack.resume_snapshot_sha256
        ? { resume_snapshot_sha256: pack.resume_snapshot_sha256 }
        : {}),
      ...(pack.document_version_id ? { document_version_id: pack.document_version_id } : {}),
      ...(pack.reviewer ? { reviewer: pack.reviewer } : {}),
      ...(pack.created_at ? { created_at: pack.created_at } : {}),
      annotations: pack.annotations,
    },
    null,
    2,
  );
}
