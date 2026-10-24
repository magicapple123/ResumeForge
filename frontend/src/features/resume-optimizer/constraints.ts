// SPDX-License-Identifier: Apache-2.0
/**
 * 「有约束的版面优化」的**纯规则**（W09 / P1-04）。
 *
 * ## 为什么不自己生成候选
 *
 * 候选来自既有版面诊断接口的 `fit_ladder`（后端 `resume_fit.build_fit_ladder`）：它已经
 * 按"页边距 → 区块间距 → 行高 → 字号"排好序、每档是**完整覆盖**。W09 只做三件事：
 * 按用户约束过滤、挑出最多 3 个**有差异**的方案、用真实测量评估"够不够 / 少了多少溢出"。
 * 再写一套候选生成就是第二套排版规则，迟早与「自动一页」给出不同结论。
 *
 * ## 三条诚实约束
 *
 * 1. **不动字号**是硬过滤：候选只要改了 `font_scale_adjust` 就排除（不是"改了再提醒"）。
 * 2. **最小页边距**是硬过滤：候选的 `page_padding` 低于下限就排除。
 * 3. **保持条目完整**不在这里过滤：阶梯只改间距与字号，本来就不动条目结构；草稿预览是
 *    近似分页，真实分页以精确预览为准（W08）。这里把它标成"约束已声明、不产生过滤"，
 *    不让用户以为它改了什么实际没改的东西。
 */
import type { ResumeFitCandidate } from "../../types/resumeLayout";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import { overflowHeightFor, pagesNeededFor } from "../../utils/resumeLayoutMeasure";
import {
  OPTIMIZER_PARAM_KEYS,
  type MeasuredCandidate,
  type NoFeasibleReason,
  type OptimizerCandidateView,
  type OptimizerConstraints,
  type OptimizerCurrentValues,
  type OptimizerParamKey,
  type ParameterChange,
  type ReadabilityImpact,
} from "./types";

const EPSILON = 1e-9;

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 候选配置里某个参数的生效值（缺省回落到当前值）。 */
export function candidateValue(
  config: ResumeFitCandidate["config"],
  key: OptimizerParamKey,
  current: OptimizerCurrentValues,
): number {
  return asNumber((config as Record<string, unknown>)[key], current[key]);
}

/** 候选相对当前生效值改了哪些参数（只列真正变化的）。 */
export function changesBetween(
  current: OptimizerCurrentValues,
  config: ResumeFitCandidate["config"],
): ParameterChange[] {
  const changes: ParameterChange[] = [];
  for (const key of OPTIMIZER_PARAM_KEYS) {
    const from = current[key];
    const to = candidateValue(config, key, current);
    if (Math.abs(to - from) <= EPSILON) continue;
    changes.push({ key, from, to });
  }
  return changes;
}

/** 可读性影响：只动页边距/区块间距最轻；动行高次之；动字号最重。 */
export function readabilityImpact(changes: readonly ParameterChange[]): ReadabilityImpact {
  let impact: ReadabilityImpact = "none";
  for (const change of changes) {
    if (change.key === "font_scale_adjust") return "noticeable";
    if (change.key === "line_height") impact = "mild";
    else if (change.key === "section_gap" && impact === "none") impact = "mild";
  }
  return impact;
}

/** 字号缩小百分比（仅当候选改了字号系数；null = 没改或不适用）。 */
export function fontDeltaPercent(changes: readonly ParameterChange[]): number | null {
  const change = changes.find((item) => item.key === "font_scale_adjust");
  if (!change || change.from <= 0) return null;
  const percent = ((change.from - change.to) / change.from) * 100;
  return Math.max(0, Math.round(percent * 10) / 10);
}

/** 把一档后端候选包成界面视图（不含测量结论）。 */
export function toCandidateView(
  candidate: ResumeFitCandidate,
  current: OptimizerCurrentValues,
): OptimizerCandidateView {
  const changes = changesBetween(current, candidate.config);
  return {
    key: candidate.key,
    label: candidate.label,
    config: candidate.config,
    css: candidate.css,
    changes,
    readability: readabilityImpact(changes),
    fontDeltaPercent: fontDeltaPercent(changes),
  };
}

/** 约束过滤的结果（含"被谁排除"的计数，用于解释不可行原因）。 */
export interface FilterResult {
  views: OptimizerCandidateView[];
  rejectedByFontLock: number;
  rejectedByMargin: number;
}

/** 按用户约束过滤候选（顺序保持后端阶梯顺序）。 */
export function filterCandidates(
  ladder: readonly ResumeFitCandidate[],
  current: OptimizerCurrentValues,
  constraints: OptimizerConstraints,
): FilterResult {
  const views: OptimizerCandidateView[] = [];
  let rejectedByFontLock = 0;
  let rejectedByMargin = 0;
  for (const candidate of ladder) {
    const view = toCandidateView(candidate, current);
    if (constraints.lockFont && view.changes.some((change) => change.key === "font_scale_adjust")) {
      rejectedByFontLock += 1;
      continue;
    }
    if (constraints.minMarginMm !== null) {
      const padding = candidateValue(candidate.config, "page_padding", current);
      if (padding < constraints.minMarginMm - EPSILON) {
        rejectedByMargin += 1;
        continue;
      }
    }
    views.push(view);
  }
  return { views, rejectedByFontLock, rejectedByMargin };
}

/**
 * 挑最多 `max` 个**有差异**的方案：温和（只动间距）→ 中等（动行高）→ 明显（动字号），
 * 不足时补最后一档（最强）。按后端阶梯顺序返回。
 */
export function pickCandidateSamples(
  views: readonly OptimizerCandidateView[],
  max = 3,
): OptimizerCandidateView[] {
  if (views.length === 0) return [];
  const picked = new Map<string, OptimizerCandidateView>();
  const add = (view: OptimizerCandidateView | undefined) => {
    if (view && !picked.has(view.key) && picked.size < max) picked.set(view.key, view);
  };
  add(views[0]);
  add(
    views.find(
      (view) =>
        view.changes.some((change) => change.key === "line_height") &&
        !view.changes.some((change) => change.key === "font_scale_adjust"),
    ),
  );
  add(views.find((view) => view.changes.some((change) => change.key === "font_scale_adjust")));
  add(views[views.length - 1]);
  return views.filter((view) => picked.has(view.key)).slice(0, max);
}

/** 目标篇幅下还溢出多少（>0 表示放不下）。 */
export function overflowForTarget(measure: LayoutMeasure, targetPages: number): number {
  const usable = measure.pageContentHeight * Math.max(1, targetPages);
  return Math.max(0, measure.usedHeight - usable);
}

/** 实测评估：够不够、少了多少溢出、是否真的有改善。 */
export function evaluateCandidate(
  view: OptimizerCandidateView,
  before: LayoutMeasure,
  after: LayoutMeasure,
  targetPages: number,
): MeasuredCandidate {
  const overflowBefore = overflowForTarget(before, targetPages);
  const overflowAfter = overflowForTarget(after, targetPages);
  return {
    ...view,
    after,
    pagesAfter: pagesNeededFor(after),
    overflowAfter,
    overflowReduced: Math.max(0, overflowBefore - overflowAfter),
    fits: overflowAfter <= 0.5,
    // "有差异"的硬判据：实测高度真的变矮了（1px 容差），不是只改了参数没效果。
    improved: after.usedHeight < before.usedHeight - 1,
  };
}

/** 只剩测量结论里"真的变矮"的候选，按溢出减少量从多到少排序。 */
export function keepImproved(measured: readonly MeasuredCandidate[]): MeasuredCandidate[] {
  return measured
    .filter((candidate) => candidate.improved)
    .slice()
    .sort((left, right) => right.overflowReduced - left.overflowReduced);
}

/** 不可行原因：按"最可操作"的顺序给一条明确说明，不许笼统说"失败了"。 */
export function noFeasibleReason(input: {
  hasBefore: boolean;
  ladderLength: number;
  filter: FilterResult;
  measured: readonly MeasuredCandidate[];
}): NoFeasibleReason | null {
  if (!input.hasBefore) return "no_measure";
  if (input.ladderLength === 0) return "no_ladder";
  if (input.filter.views.length === 0) return "locked_out";
  if (input.measured.length === 0) return "no_room";
  if (keepImproved(input.measured).length === 0) return "no_room";
  return "still_overflow";
}

/** 当前实测是否已经放得下（放得下就没有优化必要）。 */
export function fitsAlready(measure: LayoutMeasure | null, targetPages: number): boolean {
  if (!measure) return false;
  return overflowForTarget(measure, targetPages) <= 0.5;
}

/**
 * 取某次测量相对所选页数的溢出量（界面上"溢出减少多少"的口径）。
 * 复用 `overflowHeightFor` 的唯一实现，不另写一套算术。
 */
export function measureOverflow(measure: LayoutMeasure): number {
  return overflowHeightFor(measure);
}
