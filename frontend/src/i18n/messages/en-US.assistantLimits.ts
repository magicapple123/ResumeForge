// SPDX-License-Identifier: Apache-2.0
/**
 * English pack for the assistant runtime limits (tool rounds + whole-reply time budget),
 * the context-compaction settings and the "continue" entry shown after hitting the limit.
 */
const assistantLimits = {
  "assistantLimits.settings.title": "Assistant · Runtime limits & context compaction",
  "assistantLimits.settings.intro":
    "The round limit caps how many tool-calling rounds one reply may use; the time budget caps how long the whole reply may run. Changes apply right away — no restart needed.",
  "assistantLimits.settings.rounds.label": "Tool-calling round limit",
  "assistantLimits.settings.rounds.unit": "rounds",
  "assistantLimits.settings.rounds.hint":
    "When the limit is reached the assistant stops and lets you decide whether to continue. Lowering it mid-reply takes effect on the next round.",
  "assistantLimits.settings.budget.label": "Time budget per reply",
  "assistantLimits.settings.budget.unit": "seconds",
  "assistantLimits.settings.budget.hint":
    "Covers every tool round plus the model output; the reply is aborted when it runs out. Changes apply to your next message.",
  "assistantLimits.settings.compaction.title": "Context compaction",
  "assistantLimits.settings.compaction.intro":
    "When the conversation fills the window past a threshold the assistant compacts old context: it first masks the body of early tool results, and if that is not enough it summarises older history. Nothing is deleted locally — the original text can always be restored.",
  "assistantLimits.settings.compaction.model.label": "Summary model",
  "assistantLimits.settings.compaction.model.placeholder": "Follow the current chat model",
  "assistantLimits.settings.compaction.model.hint":
    "Leave empty to follow the model used by the current chat. Summarising reads a long stretch of history, so pick a model of the same tier as your main one, not a small one.",
  "assistantLimits.settings.compaction.mask.label": "Mask threshold",
  "assistantLimits.settings.compaction.mask.unit": "%",
  "assistantLimits.settings.compaction.mask.hint":
    "Once the window is this full, the bodies of the earliest tool results are replaced with a one-line placeholder; message count and tool-call pairing stay unchanged.",
  "assistantLimits.settings.compaction.summary.label": "Summary threshold",
  "assistantLimits.settings.compaction.summary.unit": "%",
  "assistantLimits.settings.compaction.summary.hint":
    "Once the window is this full, older history is condensed into one summary block. It must be higher than the mask threshold, otherwise the two stages overlap.",
  "assistantLimits.settings.compaction.rangeHint":
    "Both thresholds must stay between {min} and {max}.",
  "assistantLimits.settings.compaction.orderHint":
    "The summary threshold must be higher than the mask threshold (currently mask {mask}% / summary {summary}%).",
  "assistantLimits.settings.save": "Save settings",
  "assistantLimits.settings.saved": "Settings saved, applies to your next message",
  "assistantLimits.settings.saveFailed": "Failed to save settings, please retry later",
  "assistantLimits.continue.hint":
    "Reached the {rounds}-round tool-calling limit, so the assistant stopped here.",
  "assistantLimits.continue.action": "Continue",
} as const;

export default assistantLimits;
