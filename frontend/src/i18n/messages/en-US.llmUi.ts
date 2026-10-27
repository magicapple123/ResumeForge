// SPDX-License-Identifier: Apache-2.0
/**
 * Shared controls in the model configuration dialog: the thinking mode section,
 * model catalog fetching and the model picker.
 */
const llmUi = {
  "llmUi.thinking.field.mode": "Thinking mode",
  "llmUi.thinking.tooltip.mode":
    "When on, AI chat and resume generation ask the model to think before answering: deeper responses, but a longer wait each turn. Structured tasks such as job recognition and match analysis are unaffected (thinking is skipped for speed). Off by default. Providers differ in how they pass thinking parameters and which levels they offer, so try the check button on the right first.",
  "llmUi.thinking.switch.on": "On",
  "llmUi.thinking.switch.off": "Off",
  "llmUi.thinking.field.effort": "Reasoning effort",
  "llmUi.thinking.placeholder.customEffort": "e.g. xhigh / max / 4096",
  "llmUi.thinking.action.usePresets": "Use a preset",
  "llmUi.thinking.option.custom": "Custom…",
  "llmUi.thinking.placeholder.defaultEffort": "Default (not specified)",
  "llmUi.thinking.field.support": "Support",
  "llmUi.thinking.tooltip.support":
    "There is no upstream API to query thinking support, so this works in two steps: the built-in table gives candidate levels, and the button sends one minimal real request to tell whether thinking actually takes effect, is silently ignored, or is rejected upstream.",
  "llmUi.thinking.action.probe": "Check thinking support",
  "llmUi.thinking.note.probe":
    "Checking thinking support sends one minimal request and counts toward your model usage. Thinking mode only applies to AI calls other than the job assistant; the assistant's reasoning effort is set separately under Reasoning effort in its input box.",
  "llmUi.catalog.error.baseUrlRequired": "Enter the Base URL before fetching available models",
  "llmUi.catalog.message.fetched": "Fetched {count} models",
  "llmUi.catalog.message.empty":
    "No available models were returned. Check the Base URL and API key, then try again, or type the model name manually.",
  "llmUi.catalog.error.fetchFailed": "Failed to fetch the model list. Try again.",
  "llmUi.catalog.field.model": "Model name",
  "llmUi.catalog.tooltip.model":
    "Fetch the models available to this account, or type a model name from the provider's docs",
  "llmUi.catalog.action.fetch": "Fetch available models",
  "llmUi.catalog.action.retry": "Retry",
  "llmUi.catalog.validation.required": "Required",
  "llmUi.picker.title": "Choose a model",
  "llmUi.picker.action.use": "Use",
} as const;

export default llmUi;
