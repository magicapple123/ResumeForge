// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区右侧「模型 · 推理等级」合并 chip（R06-B）。
 *
 * 档位名不在这里：它们由 `enumsAssistant.reasoningEffort.*` 提供
 * （`types/assistant.ts` 是档位清单的单一来源），自定义输入框的占位与无障碍名沿用
 * `assistantComposer.placeholder.customEffort` / `assistantComposer.aria.customEffort`，
 * 「模型在顶部切换」沿用 `assistantComposer.modelChip.hoverHint`——同一句话只有一个 key。
 */
const reasoningChip = {
  /** chip 的无障碍名：模型名与档位都要念出来，读屏用户才知道它管什么。 */
  "reasoningChip.aria": "当前模型与推理等级：{model} · {effort}",
  /** 面板里「模型」这一行的行首标签。 */
  "reasoningChip.row.model": "模型",
  /** 面板里「推理等级」这一行的行首标签。 */
  "reasoningChip.row.effort": "推理等级",
} as const;

export default reasoningChip;
