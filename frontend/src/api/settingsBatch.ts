// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「批量操作」的两套参数（`/api/settings/batch-operation`）。
 *
 * 生成与导出各存各的：保存其中一套不会改动另一套。`configured` 由服务端按该节是否
 * 保存过判定，前端不得用默认值推断成"已配置"。
 */
import type { ResumeFontScale, ResumeLanguage } from "../types";
import { request } from "./client";

export type BatchEnhancementLevel = "light" | "balanced" | "strong";
export type BatchExportFormat = "pdf" | "docx" | "html" | "md";
export type BatchSection = "generation" | "export";

interface BatchLayoutFields {
  /** classic / modern / compact / elegant / minimal / scholar（含自制模板）。 */
  template: string;
  format_name: string;
  font_scale: ResumeFontScale;
  page_limit: number;
  language: ResumeLanguage;
}

export interface BatchGenerationConfig extends BatchLayoutFields {
  enhance: boolean;
  enhancement_level: BatchEnhancementLevel;
  custom_instruction: string;
}

export interface BatchExportConfig extends BatchLayoutFields {
  export_format: BatchExportFormat;
}

export interface SectionMeta {
  configured: boolean;
  updated_at: string | null;
}

export type BatchGenerationConfigOut = BatchGenerationConfig & SectionMeta;
export type BatchExportConfigOut = BatchExportConfig & SectionMeta;

export interface BatchOperationConfigOut {
  generation: BatchGenerationConfigOut;
  export: BatchExportConfigOut;
}

export function getBatchOperationConfig(): Promise<BatchOperationConfigOut> {
  return request("/settings/batch-operation");
}

export function saveBatchGenerationConfig(
  payload: BatchGenerationConfig,
): Promise<BatchGenerationConfigOut> {
  return request("/settings/batch-operation/generation", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function saveBatchExportConfig(payload: BatchExportConfig): Promise<BatchExportConfigOut> {
  return request("/settings/batch-operation/export", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
