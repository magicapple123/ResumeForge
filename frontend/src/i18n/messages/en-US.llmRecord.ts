// SPDX-License-Identifier: Apache-2.0
/**
 * 模型配置记录弹窗：名称、协议、Base URL、密钥、采样参数与高级调整。
 *
 * 含多行三元的标题与错误提示留待下一批。
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
    "Most providers (including Claude's OpenAI-compatible layer) speak Chat Completions — choose OpenAI compatible. Pick the other option only when you need Claude's native Messages API.",
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
  "llmRecord.hint.unlimited":
    "When ticked, max_tokens is no longer sent and the provider decides. This helps reasoning models whose thinking eats the output budget — but it is not truly unlimited.",
  "llmRecord.label.unlimited": "No limit",
} as const;

export default llmRecord;
