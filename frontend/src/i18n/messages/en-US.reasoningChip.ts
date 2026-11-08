// SPDX-License-Identifier: Apache-2.0
/**
 * The composer's merged "model · reasoning effort" chip (R06-B).
 *
 * Level names are not here: `enumsAssistant.reasoningEffort.*` provides them (the option list
 * itself stays in `types/assistant.ts`). The custom input reuses
 * `assistantComposer.placeholder.customEffort` / `assistantComposer.aria.customEffort`, and
 * "switch it at the top" reuses `assistantComposer.modelChip.hoverHint`.
 */
const reasoningChip = {
  "reasoningChip.aria": "Current model and reasoning effort: {model} · {effort}",
  "reasoningChip.row.model": "Model",
  "reasoningChip.row.effort": "Reasoning effort",
} as const;

export default reasoningChip;
