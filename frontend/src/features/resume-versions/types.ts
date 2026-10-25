// SPDX-License-Identifier: Apache-2.0
/**
 * W13 命名版本 / 岗位变体的前端类型（与 backend/app/schemas/versions.py 逐字对齐）。
 *
 * 契约：deliverables/software-company/ResumeForge-w13-versions-contract-20261024.md。
 * 后端字段改名 = 这里改；组件不临时补形状。
 */
import type { ResumeDiff } from "../../types/resumeWriting";

/** 一条命名版本（不可变快照；frozen 只是显式标记）。 */
export interface VersionOut {
  id: number;
  resume_id: number;
  name: string;
  change_summary: string;
  job_id: number | null;
  job_title: string;
  company: string;
  content_sha256: string;
  params_sha256: string;
  source_revision: number;
  parent_version_id: number | null;
  frozen: boolean;
  /** manual = 显式创建；restore = 恢复历史时生成的新当前版本。 */
  source: string;
  created_at: string | null;
}

export interface VersionDetailOut extends VersionOut {
  content: Record<string, unknown>;
  render_context: Record<string, unknown>;
}

export interface VersionListOut {
  items: VersionOut[];
}

/** 排版上下文差异：只按顶层键报增/删/改。 */
export interface LayoutDiffOut {
  added: string[];
  removed: string[];
  changed: string[];
  equal: boolean;
}

export interface VersionCompareOut {
  base_id: number;
  /** 0 = 与当前简历比较。 */
  against_id: number;
  base_name: string;
  against_name: string;
  content: ResumeDiff;
  layout: LayoutDiffOut;
}

export interface VersionRestoreOut {
  version: VersionOut;
  /** 恢复后的当前简历记录（形状由后端 ResumeOut 决定，前端只用 revision/updated_at）。 */
  resume: Record<string, unknown>;
  revision: number;
}

export interface VersionCreateRequest {
  name: string;
  change_summary?: string;
  parent_version_id?: number | null;
}

export interface VersionFreezeRequest {
  frozen: boolean;
}

/** 岗位变体：独立表达，与当前简历互不影响。 */
export interface VariantOut {
  id: number;
  resume_id: number;
  name: string;
  job_id: number | null;
  job_title: string;
  company: string;
  content_sha256: string;
  base_version_id: number | null;
  last_synced_version_id: number | null;
  synced_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** W16 语言标签（旧变体为空串；be-prov 契约）。 */
  language?: string;
  /** W16 是否有独立排版覆盖（0060，layout 非空）。 */
  has_layout?: boolean;
}

export interface VariantDetailOut extends VariantOut {
  content: Record<string, unknown>;
  render_context: Record<string, unknown>;
  /** W16 独立排版覆盖：null = 继承。 */
  layout?: Record<string, unknown> | null;
}

export interface VariantListOut {
  items: VariantOut[];
}

export interface VariantCreateRequest {
  name: string;
  job_id?: number | null;
  base_version_id?: number | null;
  /** W16：语言标签（be-prov 契约）。 */
  language?: string;
  /** W16：派生时直接给独立排版覆盖（可选）。 */
  layout?: Record<string, unknown> | null;
}

/** 选择性同步：只有列出的变体 + 列出的路径会被改。 */
export interface VariantSyncRequest {
  source_version_id?: number | null;
  variant_ids: number[];
  paths: string[];
}

export interface VariantSyncItemOut {
  variant_id: number;
  applied_paths: string[];
  content_sha256: string;
}

export interface VariantSyncOut {
  source_version_id: number | null;
  items: VariantSyncItemOut[];
}
