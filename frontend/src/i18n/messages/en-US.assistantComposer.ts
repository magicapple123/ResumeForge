// SPDX-License-Identifier: Apache-2.0
/**
 * The assistant composer: context selects, quote chip, attachments, the skills dropdown and
 * reasoning effort.
 *
 * The reasoning-effort values (""/none/low/medium/high) are protocol values and the option
 * list still comes from `REASONING_EFFORT_OPTIONS` in `types/assistant.ts` as the single
 * source; this file only adds a "protocol value -> locale key" table resolved with `t()` at
 * render time. `types` is untouched.
 *
 * Note that `effort.off` (no reasoning) and `common.action.close` (close a window) mean
 * different things and must not share a key.
 */
const assistantComposer = {
  "assistantComposer.dropHint": "Drop to add files to the conversation",
  "assistantComposer.toast.rejectedCount": "Ignored {count} unsupported attachments",
  "assistantComposer.aria.jobSelect": "Select a related job",
  "assistantComposer.placeholder.job": "Related job (type keywords to search)",
  "assistantComposer.aria.resumeSelect": "Select a related resume",
  "assistantComposer.placeholder.resume": "Related resume (type keywords to search)",
  "assistantComposer.quote.user": "Quoting your message",
  "assistantComposer.quote.assistant": "Quoting the assistant's reply",
  "assistantComposer.aria.clearQuote": "Clear the quote",
  "assistantComposer.notice.attachments":
    "Selected attachments or profile data are sent to the model service configured right now",
  "assistantComposer.aria.remove": "Remove attachment {name}",
  "assistantComposer.action.remove": "Remove",
  "assistantComposer.action.attach": "Attach",
  "assistantComposer.aria.attach": "Add attachment",
  "assistantComposer.tooltip.attach":
    "Add a text, image or document attachment (you can also paste a screenshot)",
  "assistantComposer.tooltip.attachCompact": "Add an image or document attachment",
  "assistantComposer.placeholder.content": "Ask about jobs, resumes, projects or your job search",
  "assistantComposer.skills.label": "Skills",
  "assistantComposer.skills.count": "Skills ({count})",
  "assistantComposer.skills.hint": "Tick the skills to enable",
  "assistantComposer.skills.manage": "Open the workbench",
  "assistantComposer.skills.toggleHint": "Click to toggle assistant skills; a tick means enabled",
  "assistantComposer.toggle.webSearch": "Web search",
  "assistantComposer.effort.label": "Reasoning effort",
  "assistantComposer.effort.hint":
    "Models with a thinking mode let you set the reasoning effort here. Providers name the levels differently (low/medium/high, minimal, xhigh, max…); Custom lets you type your own. Providers that do not support the parameter ignore it, and it is dropped and retried once when rejected",
  "assistantComposer.effort.default": "Default",
  "assistantComposer.effort.off": "Off",
  "assistantComposer.effort.low": "Low",
  "assistantComposer.effort.medium": "Medium",
  "assistantComposer.effort.high": "High",
  "assistantComposer.effort.custom": "Custom…",
  "assistantComposer.aria.effortHint": "About reasoning effort",
  "assistantComposer.aria.customEffort": "Custom reasoning effort",
  "assistantComposer.placeholder.customEffort": "e.g. xhigh / max / 4096",
  "assistantComposer.action.usePreset": "Use a preset",
  "assistantComposer.action.stop": "Stop",
  "assistantComposer.aria.stop": "Stop generating",
  "assistantComposer.action.send": "Send",
  "assistantComposer.aria.send": "Send message",
} as const;

export default assistantComposer;
