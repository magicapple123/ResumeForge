// SPDX-License-Identifier: Apache-2.0
/**
 * Read-only detail dialog for a saved model configuration (opened from a record card):
 * title, field labels, protocol / key / thinking / advanced values, and the two
 * separators that join the value parts.
 *
 * The "Base URL" and "API Key" field labels stay in the component: their source text is
 * already English, so a language-pack entry would trip the "source-ascii-english" check.
 */
const llmRecordView = {
  "llmRecordView.title.detail": "Configuration details “{name}”",
  "llmRecordView.field.preset": "Preset",
  "llmRecordView.field.protocol": "API protocol",
  "llmRecordView.protocol.anthropic": "Anthropic native (Messages)",
  "llmRecordView.protocol.openai": "OpenAI compatible (Chat Completions)",
  "llmRecordView.field.model": "Model name",
  "llmRecordView.value.empty": "Not set",
  "llmRecordView.apiKey.configured": "Configured ({mask})",
  "llmRecordView.apiKey.notConfigured": "Not configured",
  "llmRecordView.field.temperature": "Creativity (temperature)",
  "llmRecordView.field.timeout": "Timeout",
  "llmRecordView.value.timeoutSeconds": "{seconds} s",
  "llmRecordView.field.maxTokens": "Max output tokens",
  "llmRecordView.maxTokens.unlimited": "No limit (the provider sets the cap)",
  "llmRecordView.field.thinking": "Thinking mode",
  "llmRecordView.thinking.onWithEffort": "On · effort {effort}",
  "llmRecordView.thinking.onPreset": "On · no effort set",
  "llmRecordView.thinking.off": "Off",
  "llmRecordView.field.advanced": "Advanced settings",
  "llmRecordView.advanced.stop": "Stop sequences",
  "llmRecordView.separator.stop": ", ",
  "llmRecordView.separator.line": "; ",
} as const;

export default llmRecordView;
