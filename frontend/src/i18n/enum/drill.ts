// SPDX-License-Identifier: Apache-2.0
/**
 * 面试深挖：协议值 → 语言包 key 的统一映射表。
 *
 * `types/drill.ts` 里那几张"协议值 → 中文展示名"的表（`FEEDBACK_LABELS` /
 * `REHEARSE_LABELS` / `ACTION_KIND_HINTS`）不直接上屏：类型层是协议值的事实来源，
 * 不该反过来依赖 i18n；而同一个协议值在开场弹窗、页头、复盘与复练里都要显示。
 * 展示名收在这里，渲染处只写 `t(KEY[value])`。
 *
 * 三条约定：
 * - 只在渲染期求值，模块作用域**不调** `t()`（否则切语言不重渲染）；
 * - 认不出的取值由调用方回退（`?? value` / `?? ""`），这里不塞兜底文案；
 * - 颜色、图标、`value`、`key` 与协议值仍由 `types/drill.ts` 提供，不在本表里。
 *
 * 注意：开场面板 `pages/drill/StartPanel.tsx` 还留着一份只含反馈策略的本地副本
 * （那支文件不在本批的清单里），迁移它时直接换成本表的 `FEEDBACK_POLICY_LABEL_KEYS`。
 */
import type { FeedbackPolicy, RehearseKind } from "../../types";
import type { MessageKey } from "../localeTypes";

/** 反馈策略（`FEEDBACK_POLICIES`）：真实模拟 / 训练模式。 */
export const FEEDBACK_POLICY_LABEL_KEYS: Record<FeedbackPolicy, MessageKey> = {
  deferred: "enumsDrill.feedbackPolicy.deferred",
  immediate: "enumsDrill.feedbackPolicy.immediate",
};

/** 复练题型（`REHEARSE_KINDS`）：换一个角度再问的那几种问法。 */
export const REHEARSE_KIND_LABEL_KEYS: Record<RehearseKind, MessageKey> = {
  variant: "enumsDrill.rehearseKind.variant",
  counterfactual: "enumsDrill.rehearseKind.counterfactual",
  failure: "enumsDrill.rehearseKind.failure",
  evidence: "enumsDrill.rehearseKind.evidence",
  compress: "enumsDrill.rehearseKind.compress",
};

/**
 * 行动类型的展示名。键是**后端下发的协议值**（`DrillAction.kind` 的类型是 `string`，
 * 取值恰好是中文）；后端新增类型时调用方回退原文，不会渲染空白。
 */
export const ACTION_KIND_LABEL_KEYS: Readonly<Partial<Record<string, MessageKey>>> = {
  补事实: "enumsDrill.actionKind.addFact", // i18n-ok: 后端协议值（行动类型），仅作查询键
  补知识: "enumsDrill.actionKind.addKnowledge", // i18n-ok: 后端协议值（行动类型），仅作查询键
  降表述: "enumsDrill.actionKind.downgradeClaim", // i18n-ok: 后端协议值（行动类型），仅作查询键
};

/** 行动类型的一句说明（原 `ACTION_KIND_HINTS` 的取值）。 */
export const ACTION_KIND_HINT_KEYS: Readonly<Partial<Record<string, MessageKey>>> = {
  补事实: "enumsDrill.actionKindHint.addFact", // i18n-ok: 后端协议值（行动类型），仅作查询键
  补知识: "enumsDrill.actionKindHint.addKnowledge", // i18n-ok: 后端协议值（行动类型），仅作查询键
  降表述: "enumsDrill.actionKindHint.downgradeClaim", // i18n-ok: 后端协议值（行动类型），仅作查询键
};
