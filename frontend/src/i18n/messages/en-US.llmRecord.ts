// SPDX-License-Identifier: Apache-2.0
/**
 * Model configuration record dialog: name, protocol, Base URL, key, sampling parameters and
 * advanced settings.
 *
 * The multi-line ternary title, the full protocol and "no limit" explanations, the advanced
 * settings toggle and the connection test result (success with latency / failure reason) all
 * live in this file.
 */
const llmRecord = {
  "llmRecord.title.create": "New configuration",
  "llmRecord.title.edit": "Edit configuration “{name}”",
  "llmRecord.action.test": "Test connection",
  "llmRecord.action.saveRecord": "Save record",
  "llmRecord.action.save": "Save",
  "llmRecord.field.name": "Configuration name",
  "llmRecord.required.name": "Enter a configuration name",
  "llmRecord.placeholder.name": "e.g. DeepSeek campus, local Ollama",
  "llmRecord.field.preset": "Quick preset (fills Base URL and model)",
  "llmRecord.field.protocol": "API protocol",
  "llmRecord.hint.protocol":
    "Most providers (including Claude's OpenAI-compatible layer) speak Chat Completions — choose OpenAI compatible. Pick Anthropic native only when you need Claude's native Messages protocol (which supports extended thinking and a separate system field); in that case set Base URL to https://api.anthropic.com/v1 (the app appends /messages).",
  "llmRecord.protocol.openai": "OpenAI compatible (Chat Completions)",
  "llmRecord.protocol.anthropic": "Anthropic native (Messages)",
  "llmRecord.required.field": "Required",
  "llmRecord.hint.baseUrl":
    "Service address, usually https://api.example.com or https://api.example.com/v1",
  "llmRecord.field.apiKeyOptional": "API key (optional)",
  "llmRecord.field.apiKeyKeep": "API key (leave blank to keep)",
  "llmRecord.hint.apiKeyCreate":
    "Most cloud providers require one; local compatible services such as Ollama need none. The key is stored in the local database and only this machine can read it.",
  "llmRecord.hint.apiKeyEdit":
    "For safety the saved key is never shown (only a masked reference is stored). Leave blank to keep it, or enter a new value to replace it entirely.",
  "llmRecord.placeholder.apiKeyKeep": "Configured; leave blank to keep",
  "llmRecord.field.temperature": "Creativity (temperature)",
  "llmRecord.hint.temperature":
    "Controls randomness. Lower is steadier and suits factual Resumes; higher is more expressive and raises the risk of inconsistency or invention.",
  "llmRecord.temperature.strict": "Strict",
  "llmRecord.temperature.balanced": "Balanced",
  "llmRecord.temperature.creative": "Creative",
  "llmRecord.field.timeout": "Timeout (seconds)",
  "llmRecord.hint.timeout":
    "How long to wait for the response before aborting. Raise it on slow networks or long outputs — raising it never makes the model generate faster.",
  "llmRecord.field.maxTokens": "Max output tokens",
  "llmRecord.hint.maxTokens":
    "Caps the tokens in a single reply. Higher costs more; too low truncates content. This is not the model's context window.",
  "llmRecord.aria.maxTokens": "About max output tokens",
  "llmRecord.field.contextWindow": "Context window",
  "llmRecord.hint.contextWindow":
    "How many tokens this model can hold at once. Leave blank to follow the model reference (GPT-4.1 1.05M, Claude 200K); unknown models assume 128,000. The assistant panel divides by this same value. Stored locally, never sent to the provider.",
  "llmRecord.aria.contextWindow": "About context window",
  "llmRecord.contextWindow.placeholder": "Blank = model reference",
  "llmRecord.contextWindow.applyReference": "Use reference value {window}",
  "llmRecord.aria.unlimited": "About the no-limit option",
  // I-17 second batch: accessible names for the three ⓘ that replace the long
  // `Form.Item tooltip`s on Base URL / timeout / creativity.
  "llmRecord.aria.baseUrl": "About the service address",
  "llmRecord.aria.timeout": "About the timeout",
  "llmRecord.aria.temperature": "About creativity (temperature)",
  // I-17 third batch: the protocol explanation (188 characters, the longest in the repo)
  // and the API-key explanation (one name covers both the create and edit wording).
  "llmRecord.aria.protocol": "About the API protocol",
  "llmRecord.aria.apiKey": "About the API key",
  "llmRecord.hint.unlimited":
    "When ticked, max_tokens is no longer sent and the provider decides the cap. This eases the case where a reasoning model counts its thinking against the output budget and squeezes the reply empty — but it is not truly unlimited: some providers default to a value smaller than what you set by hand.",
  "llmRecord.label.unlimited": "No limit",
  "llmRecord.action.collapseAdvanced": "Hide advanced settings",
  "llmRecord.action.expandAdvanced":
    "Advanced settings (Top P / Top K, penalties, seed, stop sequences, thinking parameter style)",
  "llmRecord.test.ok": "{message} ({latency} ms)",
  "llmRecord.test.failed": "Connection failed: {message}",
} as const;

export default llmRecord;
