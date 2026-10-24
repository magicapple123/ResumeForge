// SPDX-License-Identifier: Apache-2.0
/**
 * W19 导出配置与交付原件的**前端契约镜像**（plan D18/D19/D20，wave2 契约 §6）。
 *
 * 只放类型与纯数据常量；命名规则在 `naming.ts`、能力矩阵在 `capabilities.ts`、
 * 配置校验在 `presets.ts`、D20 核对在 `check.ts`、HTTP/mock 在 `exportApi.ts`。
 *
 * 边界（契约 §6.1–§6.3）：
 * - **导出配置** = 数据集级命名预设（格式组合/命名规则/水印/脱敏/归档开关），进备份；
 * - **交付原件** = 可选归档的**文件字节**（sha256 + 资源版本清单），与投递快照（结构化数据）分开；
 * - 工作区预设（localStorage）不是导出配置，两者不混。
 */
import type { ResumeContent } from "../../types/resume";

/** 可成套导出的格式（顺序即界面顺序：先交付主格式，后机器可读）。 */
export const EXPORT_FORMATS = ["pdf", "docx", "html", "md", "txt", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 能力矩阵档位（与 plan W05 的"支持/近似/不支持"三档一致）。 */
export type ExportCapabilityLevel = "full" | "approx" | "unsupported";

/** 不支持/近似的机器可读原因（UI 用 t() 翻成人话；这一层不依赖 i18n）。 */
export type ExportCapabilityReason = "layout" | "fonts" | "not-applicable";

export interface ExportCapability {
  level: ExportCapabilityLevel;
  reason?: ExportCapabilityReason;
}

/** 一个命名导出配置的**可编辑部分**（不含 id/名称；名称在预设实体上）。 */
export interface ExportPresetConfig {
  /** 至少一项；顺序即包内文件顺序。 */
  formats: ExportFormat[];
  /** 命名模板（`{name}-{job_title}-{date}`）；空串 = 用既有默认命名（零变化）。 */
  naming: string;
  /** 水印文字；空串 = 无水印。 */
  watermark: string;
  /** 是否脱敏（对外发送）。 */
  redact: boolean;
  include_photo: boolean;
  /** 是否把本次导出的文件字节归档为"交付原件"（默认关，见契约 §6.9 Q1）。 */
  archive_original: boolean;
}

/** 数据集级的命名导出预设（后端 `resume_export_preset`）。 */
export interface ExportPreset {
  id: number;
  name: string;
  description: string;
  config: ExportPresetConfig;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 默认配置：六格式里只勾 PDF（最常见），其余按默认关（渐进展示）。 */
export function defaultPresetConfig(): ExportPresetConfig {
  return {
    formats: ["pdf"],
    naming: "",
    watermark: "",
    redact: false,
    include_photo: true,
    archive_original: false,
  };
}

/** 成套导出请求（契约 §6.5；`preset_id` 与内联字段二选一，字段同一位置）。 */
export interface ExportBundleRequest {
  preset_id?: number;
  formats?: ExportFormat[];
  watermark?: string;
  redact?: boolean;
  include_photo?: boolean;
  archive_original?: boolean;
  /** 发起导出时看到的修订号：`strict_revision` 时服务端比对。 */
  resume_revision?: number;
  strict_revision?: boolean;
  /** 当前草稿正文（W04 缺口）：与预览同一份内容，后端不落库、不冻结。 */
  content?: ResumeContent;
  /** 草稿版式：仅当宿主把未保存的版式传进来时带。 */
  margin_mm?: number;
  font_scale?: string;
  page_limit?: number;
  format_config?: Record<string, unknown>;
  language?: string;
}

/** zip 内 manifest 的逐文件摘要（契约 §6.5）。 */
export interface ExportBundleFile {
  name: string;
  format: ExportFormat;
  sha256: string;
  size: number;
  pages?: number | null;
  pages_needed?: number | null;
  overflow?: boolean;
}

export interface ExportBundleSnapshot {
  content_sha256: string;
  render_config_sha256: string;
}

export interface ExportBundleManifest {
  generated_at: string;
  resume_revision: number;
  snapshot: ExportBundleSnapshot;
  files: ExportBundleFile[];
  resource_manifest: Record<string, unknown>;
  redacted: boolean;
  watermark: boolean;
}

/** 一份归档的交付原件（后端 `resume_export_artifact`）。 */
export interface ExportArtifactRecord {
  id: number;
  delivery_id: number | null;
  resume_id: number | null;
  kind: string;
  export_format: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  resource_manifest: Record<string, unknown>;
  created_at: string;
}

/** D20 导出前核对摘要（`POST /preflight` 的 `export_summary`）。 */
export interface ExportCheckSummary {
  target_company: string;
  target_job_title: string;
  resume_title: string;
  contact_present: boolean;
  document_mode: string;
  revision: number;
  revision_changed: boolean;
  hidden_count: number;
}

/** 严格版本核对失败时的业务码（形状与 `resume_revision_conflict` 一致）。 */
export const EXPORT_REVISION_CHANGED_CODE = "resume_revision_changed";

/** 归档原件的容量上限（契约 §6.6：默认每份简历 20 个，超限拒绝新增并提示删旧）。 */
export const MAX_ARTIFACTS_PER_RESUME = 20;
