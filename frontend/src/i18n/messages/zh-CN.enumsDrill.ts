// SPDX-License-Identifier: Apache-2.0
/**
 * 面试深挖的枚举展示名：反馈策略、复练题型、行动类型与行动说明。
 *
 * 取值来自 `types/drill.ts` 的三张表（`FEEDBACK_LABELS` / `REHEARSE_LABELS` /
 * `ACTION_KIND_HINTS`），中文与类型层**逐字一致**——迁移只换取值来源，不换渲染结果。
 * 协议值本身（`deferred` / `variant` / 后端下发的「补事实」…）永远不翻译。
 */
const enumsDrill = {
  "enumsDrill.feedbackPolicy.deferred": "真实模拟：结束时统一给反馈",
  "enumsDrill.feedbackPolicy.immediate": "训练模式：每题后立刻反馈",
  "enumsDrill.rehearseKind.variant": "变体题",
  "enumsDrill.rehearseKind.counterfactual": "反事实题",
  "enumsDrill.rehearseKind.failure": "故障题",
  "enumsDrill.rehearseKind.evidence": "证据题",
  "enumsDrill.rehearseKind.compress": "压缩表达",
  "enumsDrill.actionKind.addFact": "补事实",
  "enumsDrill.actionKind.addKnowledge": "补知识",
  "enumsDrill.actionKind.downgradeClaim": "降表述",
  "enumsDrill.actionKindHint.addFact": "你确实做过，但没整理出细节——去把当时的决策、难点、口径补上",
  "enumsDrill.actionKindHint.addKnowledge": "这块你确实还不掌握——去学",
  "enumsDrill.actionKindHint.downgradeClaim": "事实站不住——把简历里那句话改弱，别硬撑",
} as const;

export default enumsDrill;
