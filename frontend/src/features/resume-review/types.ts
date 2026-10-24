// SPDX-License-Identifier: Apache-2.0
/**
 * W18 离线对象批注（D17）的前端契约：`annotations.json` sidecar v1。
 *
 * 依据 `deliverables/software-company/ResumeForge-workbench-wave3-contracts-20261024.md` §4：
 * - 传输复用既有离线分享包；评审包 = 既有 HTML/PDF + `annotations.json` + 说明；
 * - 批注锚点优先 `object_id`（要点级加 `point_id`），`path` 只是**兼容锚点**（旧包/无 id）；
 * - 状态机 `open → resolved | dismissed | stale`，stale 只能"重挂到当前对象"或忽略；
 * - 导入九步 fail-closed、按 `(share_package_id, external_id)` 去重、**不更新**已有批注；
 * - 批注永不进入投递产物（HTML/PDF/Word/MD/TXT/交付 JSON）。
 *
 * 这一层只放类型与常量；解析/校验在 `pack.ts`，定位展示在 `anchors.ts`，
 * 列表合并在 `dedupe.ts`，HTTP/mock 适配在 `reviewApi.ts`。
 */

/** 包格式标识（契约 §4.2：`kind`）。 */
export const REVIEW_PACK_KIND = "resumeforge.review";
/** 当前支持的格式版本；未知版本整包拒绝（fail-closed）。 */
export const REVIEW_PACK_VERSION = 1;
/** 文件大小上限：512 KiB（契约 §4.2）。 */
export const REVIEW_PACK_MAX_BYTES = 512 * 1024;
/** 单包批注条数上限。 */
export const REVIEW_ANNOTATIONS_MAX = 500;
/** 单条批注正文 / 引用原文 / external_id / reviewer 上限。 */
export const REVIEW_TEXT_MAX = 2_000;
export const REVIEW_QUOTED_MAX = 200;
export const REVIEW_EXTERNAL_ID_MAX = 64;
export const REVIEW_REVIEWER_MAX = 64;
/** 兼容锚点 path 的上限与字符集（`data-resume-path` 形态）。 */
export const REVIEW_PATH_MAX = 256;
export const REVIEW_PATH_PATTERN = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
/** 分享包 token：32 位十六进制（契约 §4.2）。 */
export const REVIEW_SHARE_TOKEN_PATTERN = /^[0-9a-fA-F]{32}$/;
/** 评审包 zip 里的 sidecar 文件名（后端生成/前端提示共用同一个名字）。 */
export const REVIEW_PACK_FILENAME = "annotations.json";

/** 批注状态机（契约 §4.3）。 */
export type ReviewAnnotationStatus = "open" | "resolved" | "stale" | "dismissed";

/** 包内一条批注（收件人填写；键名与契约 §4.2 逐字一致）。 */
export interface ReviewPackAnnotation {
  /** 收件端生成的去重键，≤64 且非空（服务端与 share_package_id 组成唯一约束）。 */
  external_id: string;
  /** W01 稳定对象 id（首选锚点；旧包可能没有）。 */
  object_id?: string;
  /** 要点级批注（可选；需要同时给 `field` 便于展示分组）。 */
  point_id?: string;
  /** 兼容锚点（旧包/无 object_id 时）；**不得**用来定位新对象。 */
  path?: string;
  /** 字段名（`description` 等），仅展示分组用。 */
  field?: string;
  /** 批注时看到的原文片段，≤200。 */
  quoted_text?: string;
  /** 批注正文，≤2000。 */
  text: string;
  created_at?: string;
}

/** 一个完整的 `annotations.json`（包内 sidecar）。 */
export interface ReviewPack {
  format_version: number;
  kind: string;
  /** 生成分享包时的 token（导入时服务端会做常数时间比对）。 */
  share_token: string;
  /** 包内快照（`package.snapshot`）的规范化 sha256：不一致时整批标 stale，不拒绝。 */
  package_snapshot_sha256: string;
  /** 可选：来源简历 content 的规范化哈希（W02 口径）。 */
  resume_snapshot_sha256?: string;
  /** 可选：W13 命名版本 id；有则服务端校验属于同一简历。 */
  document_version_id?: number | null;
  /** 收件人自填显示名（不可信输入，≤64，渲染时转义）。 */
  reviewer?: string;
  created_at?: string;
  annotations: ReviewPackAnnotation[];
}

/** 解析失败原因码（UI 用 t() 翻成人话；这一层不依赖 i18n）。 */
export type ReviewPackIssueCode =
  | "too-large"
  | "not-json"
  | "bad-format"
  | "bad-version"
  | "bad-token"
  | "bad-snapshot"
  | "bad-reviewer"
  | "bad-annotations"
  | "bad-annotation"
  | "duplicate-external-id";

export interface ReviewPackIssue {
  code: ReviewPackIssueCode;
  /** 出问题的批注下标（逐条校验失败时）。 */
  index?: number;
  /** 出问题的字段名（`external_id` / `object_id` / `text` …）。 */
  field?: string;
}

export type ReviewPackParseResult =
  { ok: true; pack: ReviewPack } | { ok: false; issues: ReviewPackIssue[] };

/** 服务端返回的一条批注（契约 §4.3 表字段的前端镜像）。 */
export interface ReviewAnnotationRecord {
  id: number;
  share_package_id: number | null;
  resume_id: number | null;
  document_version_id: number | null;
  /** 导入时包的快照指纹：与当前包不一致 → 该批 stale。 */
  snapshot_sha256: string;
  external_id: string;
  object_id: string | null;
  point_id: string | null;
  path: string | null;
  field: string | null;
  quoted_text: string;
  text: string;
  reviewer: string;
  status: ReviewAnnotationStatus;
  resolved_at: string | null;
  created_at: string;
}

/** 导入响应（契约 §4.4）。 */
export interface ReviewImportResult {
  imported: number;
  duplicates: number;
  stale: number;
  dismissed_existing: number;
  annotations: ReviewAnnotationRecord[];
}

/** "重新关联到当前对象"的目标（用户显式选择；不带下标）。 */
export interface ReviewTarget {
  object_id: string;
  point_id?: string | null;
}

/** 批注列表筛选：全部 / 待解决 / 已解决 / 已失联 / 已忽略。 */
export type ReviewStatusFilter = "all" | "open" | "resolved" | "stale" | "dismissed";
