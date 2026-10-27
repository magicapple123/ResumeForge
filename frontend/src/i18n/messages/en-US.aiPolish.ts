// SPDX-License-Identifier: Apache-2.0
/**
 * AI polish floating card: the selected text, the instruction box, the rewritten result,
 * iterating on that result, and the too-long / no-model notices.
 *
 * The no-model notice is two keys because the original sentence wraps a navigation `Link`:
 * i18n has no rich-text interpolation, so the conclusion and the action are complete
 * sentences of their own instead of "before + link + after" fragments.
 */
const aiPolish = {
  "aiPolish.title": "AI polish",
  "aiPolish.privacy": "Only the selected passage is sent, never the whole Resume",
  "aiPolish.dragHint": "Drag the title bar to move this card",

  "aiPolish.label.source": "Original text",
  "aiPolish.label.selection": "Selected text",

  "aiPolish.label.result": "Rewritten text (edit it directly)",
  "aiPolish.aria.result": "Rewritten text",

  "aiPolish.label.followUp": "Follow-up instruction (optional)",
  "aiPolish.aria.followUp": "Follow-up instruction",
  "aiPolish.placeholder.followUp": "e.g. Make it more concise / Highlight quantified results",

  "aiPolish.label.instruction": "Your instruction (optional)",
  "aiPolish.aria.instruction": "Polish instruction",
  "aiPolish.placeholder.instruction":
    "e.g. More concise, highlight achievements, restructure as STAR",

  "aiPolish.action.start": "Start rewriting",
  "aiPolish.action.continue": "Rewrite again with instruction",
  "aiPolish.action.restart": "Start over from original",
  "aiPolish.action.replace": "Replace selection",

  "aiPolish.followUp.tooLong":
    "The text to rewrite is over {limit} characters. Shorten it manually first",
  "aiPolish.tooLong.title": "The selected text is over {limit} characters",
  "aiPolish.tooLong.body": "Only one passage can be polished at a time. Select a smaller range.",

  "aiPolish.modelMissing.title": "No model is configured yet",
  "aiPolish.modelMissing.body": "Polishing needs a configured model to work.",
  "aiPolish.modelMissing.action": "Configure a model in Settings",

  "aiPolish.error.title": "Polishing did not finish",
  "aiPolish.error.failed": "Polishing failed. Try again later",
  "aiPolish.error.maxLength":
    "This Field has a character limit and cannot hold the rewrite. Shorten the result before replacing.",
  "aiPolish.error.targetGone":
    "The original input is gone (the page may have changed). Select the text again.",
} as const;

export default aiPolish;
