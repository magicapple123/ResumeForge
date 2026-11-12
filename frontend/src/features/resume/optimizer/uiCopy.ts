// SPDX-License-Identifier: Apache-2.0
/**
 * 优化器面板的纯展示常量与文案拼装（从 `LayoutOptimizerPanel.tsx` 拆出，守 500 行预算）。
 *
 * 这里只有"把规则结果翻译成界面上的一句话"：不读状态、不调接口，所以可以单独测。
 */
import { ot } from "./i18n";
import type {
  NoFeasibleReason,
  OptimizerConstraints,
  ParameterChange,
  ReadabilityImpact,
} from "./types";

export const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  lockFont: false,
  minMarginMm: null,
  keepEntriesWhole: true,
  targetPages: 1,
};

/** 不可行原因 → 提示文案 key（按"最可操作"的顺序取用）。 */
export const REASON_KEYS: Record<NoFeasibleReason, Parameters<typeof ot>[0]> = {
  no_ladder: "optimizer.empty",
  locked_out: "optimizer.noFeasible.locked",
  still_overflow: "optimizer.noFeasible.stillOverflow",
  no_room: "optimizer.noFeasible.noRoom",
  no_measure: "optimizer.noMeasure",
};

export const READABILITY_KEYS: Record<ReadabilityImpact, Parameters<typeof ot>[0]> = {
  none: "optimizer.candidate.readability.none",
  mild: "optimizer.candidate.readability.mild",
  noticeable: "optimizer.candidate.readability.noticeable",
};

export const READABILITY_COLORS: Record<ReadabilityImpact, string> = {
  none: "green",
  mild: "blue",
  noticeable: "orange",
};

function formatValue(key: ParameterChange["key"], value: number): string {
  if (key === "page_padding") return String(Math.round(value * 100) / 100);
  return String(Math.round(value * 1000) / 1000);
}

/** 一条参数变化的人话（"页边距 14 → 12 mm"）。 */
export function changeText(change: ParameterChange): string {
  const from = formatValue(change.key, change.from);
  const to = formatValue(change.key, change.to);
  if (change.key === "page_padding") return ot("optimizer.change.padding", { from, to });
  if (change.key === "section_gap") return ot("optimizer.change.sectionGap", { from, to });
  if (change.key === "line_height") return ot("optimizer.change.lineHeight", { from, to });
  return ot("optimizer.change.fontScale", { from, to });
}
