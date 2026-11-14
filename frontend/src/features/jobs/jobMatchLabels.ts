// SPDX-License-Identifier: Apache-2.0
/** 岗位匹配度弹窗的展示常量与分项显示名（从 JobMatchModal 拆出，压 500 行预算）。
 *
 * 纯数据/纯函数，无 JSX：硬门槛与五类结论的显示名映射、「参考分」分项的展示名。
 */
import type { HardGateResult, JobMatchOut, MatchScoreDimension } from "../../types";
import { t, type MessageKey } from "../../i18n";
import { matchScoreDimensionKey } from "../../i18n/enum/apply";

export const HARD_GATE_LABELS: Record<HardGateResult, { labelKey: MessageKey; color: string }> = {
  met: { labelKey: "jobMatch.hardGate.met", color: "green" },
  unmet: { labelKey: "jobMatch.hardGate.unmet", color: "red" },
  unknown: { labelKey: "jobMatch.hardGate.unknown", color: "gold" },
};

export const GROUPS: {
  key: keyof Pick<JobMatchOut["result"], "hard_conditions" | "core_abilities" | "bonus_items">;
  titleKey: MessageKey;
}[] = [
  { key: "hard_conditions", titleKey: "jobMatch.group.hardConditions" },
  { key: "core_abilities", titleKey: "jobMatch.group.coreAbilities" },
  { key: "bonus_items", titleKey: "jobMatch.group.bonusItems" },
];

/**
 * 参考分分项的展示名：按后端稳定的 `key` 查语言包。
 *
 * `label` 是后端下发的中文展示名（`MATCH_SCORE_DIMENSIONS`），英文界面下会露中文；
 * 后端新增分项时表里查不到，回退它下发的原文——不显示 key，也不留空。
 */
export function dimensionLabel(dimension: MatchScoreDimension): string {
  const labelKey = matchScoreDimensionKey(dimension.key);
  return labelKey ? t(labelKey) : dimension.label;
}
