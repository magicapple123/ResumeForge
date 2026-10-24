// SPDX-License-Identifier: Apache-2.0
/**
 * 「有约束的版面优化」（W09 / P1-04）的前端类型。
 *
 * 数据来源是**既有**的版面诊断接口（`POST /resumes/{id}/layout/analyze`）：
 * `fit_ladder` 已经是"从当前版式往紧收"的逐档完整覆盖，本模块不另造一套候选生成算法，
 * 只在它之上做**约束过滤 + 取样 + 真实测量评估**。
 */
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import type { ResumeFitCandidate } from "../../types/resumeLayout";

/** 参与优化的四个排版参数键（与后端 `_effective_layout` 的四个旋钮一一对应）。 */
export type OptimizerParamKey =
  "page_padding" | "section_gap" | "line_height" | "font_scale_adjust";

export const OPTIMIZER_PARAM_KEYS: readonly OptimizerParamKey[] = [
  "page_padding",
  "section_gap",
  "line_height",
  "font_scale_adjust",
];

/** 当前生效值（由宿主从 layout 解析后传入；缺省视为未设过）。 */
export interface OptimizerCurrentValues {
  page_padding: number;
  section_gap: number;
  line_height: number;
  font_scale_adjust: number;
}

/** 用户约束。 */
export interface OptimizerConstraints {
  /** 不动字号（= 不允许候选改 `font_scale_adjust`）。 */
  lockFont: boolean;
  /** 页边距下限（mm）；null = 不限制。 */
  minMarginMm: number | null;
  /** 保持条目完整（见 constraints.ts 的诚实说明：只收紧间距/字号，不改结构）。 */
  keepEntriesWhole: boolean;
  /** 目标篇幅（页）。 */
  targetPages: 1 | 2;
}

/** 一个参数变化。 */
export interface ParameterChange {
  key: OptimizerParamKey;
  from: number;
  to: number;
}

/** 可读性影响等级。 */
export type ReadabilityImpact = "none" | "mild" | "noticeable";

/** 界面上的一个候选方案。 */
export interface OptimizerCandidateView {
  /** 后端阶梯里的 key（同一次分析内唯一）。 */
  key: string;
  label: string;
  /** 完整覆盖配置（应用时合并进 format_config）。 */
  config: ResumeFitCandidate["config"];
  /** 注入预览测量用的 CSS。 */
  css: string;
  changes: ParameterChange[];
  readability: ReadabilityImpact;
  /** 字号缩小的百分比（仅当改了字号系数时有值）。 */
  fontDeltaPercent: number | null;
}

/** 实测后的候选结论。 */
export interface MeasuredCandidate extends OptimizerCandidateView {
  after: LayoutMeasure;
  pagesAfter: number;
  overflowAfter: number;
  overflowReduced: number;
  fits: boolean;
  /** 是否真的让溢出变少（"有差异"的硬判据）。 */
  improved: boolean;
}

/** 不可行原因（用于明确说明"为什么没有方案"，不许假装成功）。 */
export type NoFeasibleReason =
  "no_ladder" | "locked_out" | "still_overflow" | "no_room" | "no_measure";
