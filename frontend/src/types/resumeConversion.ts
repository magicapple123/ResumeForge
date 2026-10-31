// SPDX-License-Identifier: Apache-2.0
/**
 * 旧简历 v1 → v2 转换摘要（`ResumeDetail.document_conversion` 的元素类型）。
 *
 * 从 types/resume.ts 拆出：那个文件贴着 500 行预算，而这张摘要只在详情读取时出现一次。
 * 既有导入路径由 resume.ts 的 re-export 保持不变。
 */

/** 旧简历 v1 → v2 转换摘要（后端 `ConversionReport.as_dict()` 逐字对应）。 */
export interface DocumentConversionSummary {
  version: number;
  source_version: number;
  fields_recognized: number;
  lines_preserved: number;
  fields_dropped: number;
  fields_merged: number;
  custom_fields_recorded: number;
  empty_sections: string[];
  warnings: string[];
}
