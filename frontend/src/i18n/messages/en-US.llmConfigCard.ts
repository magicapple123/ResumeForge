// SPDX-License-Identifier: Apache-2.0
/**
 * Settings · "Model API configuration" card: header and create entry, intro banner, empty
 * state, record cards (active tag, masked-key notice, Use / Test connection / more actions),
 * connection test results and the delete confirmation.
 *
 * Model names and endpoints on a record come from the user, so only the "not filled in"
 * fallbacks live here; preset names and the API key placeholder belong to
 * `SettingsConfig.ts` and the `llmRecord` pack and are not duplicated.
 */
const llmConfigCard = {
  "llmConfigCard.card.title": "Model API configuration",
  "llmConfigCard.action.create": "New configuration",
  "llmConfigCard.hint.intro":
    "Works with any model service that speaks the OpenAI Chat Completions protocol (DeepSeek, Doubao, Kimi, Qwen, Zhipu, MiniMax, SiliconFlow, OpenRouter, OpenAI, Gemini, Ollama and more), and can switch to Anthropic's native protocol to reach Claude directly. Every dataset shares this configuration: each card is a saved record — click the card to see its details, test the connection or switch In use right there. API keys are encrypted in the local data directory and never enter a backup.",
  "llmConfigCard.empty.description":
    "No configurations yet. Use “New configuration” to create the first one; the active configuration keeps working.",

  "llmConfigCard.legacy.title":
    "Still using this dataset's old configuration; saving upgrades it to a global configuration",
  "llmConfigCard.legacy.description":
    "In use: {model} · {baseUrl}. Save once (or create a record and click “Use”) to share it across all datasets.",
  "llmConfigCard.fallback.model": "No model set",
  "llmConfigCard.fallback.baseUrl": "No endpoint set",

  "llmConfigCard.tooltip.updatedAt": "Updated {time}",
  "llmConfigCard.tooltip.active":
    "Active configuration: Resume generation and the career assistant use it",
  "llmConfigCard.tag.active": "In use",
  "llmConfigCard.tag.keyConfigured": "API key set",

  "llmConfigCard.action.apply": "Use",
  "llmConfigCard.action.test": "Test connection",
  "llmConfigCard.action.edit": "Edit",
  "llmConfigCard.action.delete": "Delete",
  "llmConfigCard.action.cancel": "Cancel",
  "llmConfigCard.aria.moreActions": "More actions for {name}",

  "llmConfigCard.test.ok": "{message} ({latency} ms)",
  "llmConfigCard.test.failed": "Connection failed: {message}",

  "llmConfigCard.confirm.deleteTitle": "Delete record “{name}”?",
  "llmConfigCard.confirm.deleteContent":
    "Deleting a record does not affect the configuration in use",
} as const;

export default llmConfigCard;
