// SPDX-License-Identifier: Apache-2.0
/** 版式诊断与「自动一页」的类型定义（从 `resume.ts` 纯搬出，字段与注释不变）。
 *
 *  单独成文件的理由：这一组只描述"排出来量到了什么"（诊断 + 候选版式 + 剩余空间），
 *  与简历内容 / 列表 / 生成选项无关；`resume.ts` 只 re-export，历史导入路径不变。 */
import type { ResumeFormatConfig } from "./resumeFormat";

/** 「自动一页」用的实测高度，单位随意、只要两者同单位（前端传的是 CSS 像素）。 */
export interface ResumeLayoutMeasure {
  used_height: number;
  page_content_height: number;
  page_limit: number;
}

export type ResumeLayoutStatus =
  "overflow" | "dense" | "healthy" | "sparse" | "too_sparse" | "unknown";

export interface ResumeLayoutSuggestion {
  kind: string;
  title: string;
  detail: string;
}

export interface ResumeLayoutPageFill {
  page: number;
  fill: number;
}

export interface ResumeLayoutDiagnosis {
  status: ResumeLayoutStatus;
  status_label: string;
  summary: string;
  /** 整体填充度（0~1 的小数，可能大于 1 表示溢出）。 */
  fill: number;
  pages_needed: number;
  page_limit: number;
  pages: ResumeLayoutPageFill[];
  suggestions: ResumeLayoutSuggestion[];
}

/** 一档候选版式：把 `css` 注入预览、量一次，够放下就用它。 */
export interface ResumeFitCandidate {
  key: string;
  label: string;
  config: ResumeFormatConfig;
  css: string;
}

export interface ResumeFitRoom {
  has_room: boolean;
  steps: number;
  font_floor_px: number;
  font_adjust_floor: number;
  font_floor_note: string;
}

export interface ResumeLayoutAnalysis {
  diagnosis: ResumeLayoutDiagnosis;
  fit_ladder: ResumeFitCandidate[];
  fit_room: ResumeFitRoom;
}
