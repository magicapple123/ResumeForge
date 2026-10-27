// SPDX-License-Identifier: Apache-2.0
/**
 * App-level display tables: brand name, model presets, enhancement levels, reasoning effort
 * and thinking-style options, generation stages, the GitHub star prompt, the header source
 * link, and the copy used by the resume detail preview and the model-config hooks.
 *
 * These strings used to live in module-level constant tables (`config.ts`,
 * `settings/SettingsConfig.ts`, `thinkingMeta.ts`). Tables hold keys only — nothing calls
 * `t()` at module scope, because that never re-evaluates after a language switch.
 */
const appConfig = {
  // ── Brand ───────────────────────────────────────────────────
  /** Single source of truth for the app name (header, document title, star prompt, source link). */
  "appConfig.brand.name": "ResumeForge",

  // ── Model presets (fill Base URL and model name) ─────────────
  "appConfig.preset.deepseek": "DeepSeek",
  "appConfig.preset.anthropic": "Claude (Anthropic native protocol)",
  "appConfig.preset.doubao": "Doubao (Volcengine Ark)",
  "appConfig.preset.kimi": "Kimi (Moonshot)",
  "appConfig.preset.qwen": "Qwen (Alibaba Cloud Bailian)",
  "appConfig.preset.zhipu": "Zhipu GLM",
  "appConfig.preset.minimax": "MiniMax",
  "appConfig.preset.siliconflow": "SiliconFlow",
  "appConfig.preset.openrouter": "OpenRouter (aggregator)",
  "appConfig.preset.openai": "OpenAI",
  "appConfig.preset.gemini": "Google Gemini (OpenAI compatible)",
  "appConfig.preset.xai": "xAI Grok",
  "appConfig.preset.groq": "Groq (fast inference)",
  "appConfig.preset.mistral": "Mistral AI",
  "appConfig.preset.ollama": "Ollama (local)",
  "appConfig.preset.lmstudio": "LM Studio (local)",
  /** Custom model: keeps the current form values when selected. */
  "appConfig.preset.custom": "Custom model (OpenAI compatible)",
  /** Manual setup: clears Base URL and model so the user starts from scratch. */
  "appConfig.preset.manual": "Manual setup (no preset)",

  // ── Resume enhancement levels ────────────────────────────────
  "appConfig.enhancement.light.label": "Light",
  "appConfig.enhancement.light.description":
    "Refines wording and emphasis while keeping roughly the same length",
  "appConfig.enhancement.balanced.label": "Balanced",
  "appConfig.enhancement.balanced.description":
    "Adds methods, technical detail and concrete results",
  "appConfig.enhancement.strong.label": "Deep",
  "appConfig.enhancement.strong.description":
    "Uses all available material to strengthen the fit for the target job",
  /** A general Resume has no target job, so the Deep level needs different wording. */
  "appConfig.enhancement.strong.description-general":
    "Uses all available material to expand processes and results fully",

  // ── Reasoning effort ────────────────────────────────────────
  "appConfig.effort.minimal": "Minimal",
  "appConfig.effort.low": "Low",
  "appConfig.effort.medium": "Medium",
  "appConfig.effort.high": "High",
  /** The "unspecified level" entry in the dropdown. */
  "appConfig.effort.default": "Default (not specified)",
  /** Level name plus the raw protocol value, e.g. "Low (low)". */
  "appConfig.effort.withValue": "{label} ({effort})",
  /** Shared explanation for both branches (dropdown and custom input). */
  "appConfig.effort.tooltip":
    "Higher levels are usually slower and more expensive. Providers divide levels differently, " +
    "and the options come from Check thinking support; you can also pick Custom… and type your own. " +
    "Custom values are sent to OpenAI-compatible endpoints as-is; under the Anthropic native " +
    "protocol a number means the thinking budget in tokens, and any other word falls back to the " +
    "default level. Leave it blank to leave the level unspecified.",

  // ── Thinking parameter style (how the request body is written) ─
  "appConfig.thinkingStyle.auto": "Auto (infer from protocol and provider)",
  "appConfig.thinkingStyle.reasoningEffort": "reasoning_effort (OpenAI family)",
  "appConfig.thinkingStyle.thinkingObject": "thinking toggle (Zhipu and others)",
  "appConfig.thinkingStyle.enableThinking": "enable_thinking (Qwen 3)",
  "appConfig.thinkingStyle.budget": "thinking budget (Claude native)",

  // ── Generation stages (one per backend progress event) ───────
  "appConfig.progressStage.prepare.title": "Preparing material",
  "appConfig.progressStage.prepare.description": "Reads your profile and the job requirements",
  "appConfig.progressStage.select.title": "Selecting material",
  "appConfig.progressStage.select.description": "Picks relevant material within the page budget",
  "appConfig.progressStage.generate.title": "Generating",
  "appConfig.progressStage.generate.description": "The model is writing the Resume",
  "appConfig.progressStage.repair.title": "Fixing issues",
  "appConfig.progressStage.repair.description": "Fixes formatting or rewrites filler phrases",
  "appConfig.progressStage.done.title": "Done",
  "appConfig.progressStage.done.description": "Result saved",

  // ── GitHub star prompt ─────────────────────────────────────
  /** `{name}` is the app name (`appConfig.brand.name`). */
  "appConfig.star.title": "If {name} has been helpful",
  "appConfig.star.body":
    "A Star on GitHub means a lot — the most tangible support for independent development.",
  "appConfig.star.action": "Star on GitHub",

  // ── Header source link ─────────────────────────────────────
  "appConfig.header.repoTooltip": "View the source code or report issues on GitHub",
  /** `{name}` is the app name (`appConfig.brand.name`). */
  "appConfig.header.repoAria": "View the {name} source on GitHub",

  // ── Resume detail preview header ────────────────────────────
  /** `{job}` is the filled job title; callers fall back to `appConfig.detail.notFilled`. */
  "appConfig.detail.targetJob": "Target job: {job}",
  /** Shown when a field is empty (e.g. no job intent). */
  "appConfig.detail.notFilled": "Not filled",
  "appConfig.detail.model": "Model: {model}",
  /** `{level}` is the level name (or on/off). */
  "appConfig.detail.enhancement": "Enhancement: {level}",
  /** `{time}` is the creation timestamp (yyyy-MM-dd HH:mm). */
  "appConfig.detail.createdAt": "Created {time}",
  "appConfig.detail.rationale": "Why this Resume looks the way it does (generation notes)",
  "appConfig.detail.relayouting": "Typesetting with new settings...",

  // ── Model configuration dialog (`useLLMRecordTools`) ───────
  "appConfig.llmRecord.checkThinkingFailed": "Could not check thinking support",
  "appConfig.llmRecord.testFailed": "Test failed",
  /** Saved after editing; `{name}` is the record name. */
  "appConfig.llmRecord.savedEdit": "Configuration “{name}” saved",
  /** Saved after creating; `{name}` is the record name. New records do not activate. */
  "appConfig.llmRecord.savedCreate":
    "New configuration “{name}” saved. Click Use on its card to activate it.",
  "appConfig.llmRecord.saveFailed": "Could not save the configuration record",
  "appConfig.llmRecord.fetchModelsFailed": "Could not fetch the model list",

  // ── Settings model configuration (`useLLMSettings`) ────────
  "appConfig.llmSettings.loadFailed": "Could not load the configuration",
  /** `{name}` is the record name. */
  "appConfig.llmSettings.switched": "Switched to configuration “{name}”",
  "appConfig.llmSettings.switchFailed": "Could not switch the configuration",
  "appConfig.llmSettings.refreshFailed":
    "The configuration record was deleted, but refreshing the current configuration failed",
  /** Same as above with the failure reason; `{message}` is the error message. */
  "appConfig.llmSettings.refreshFailedDetail":
    "The configuration record was deleted, but refreshing the current configuration failed: {message}",
  "appConfig.llmSettings.deleted": "Configuration record deleted",
  "appConfig.llmSettings.deleteFailed": "Could not delete the configuration record",
} as const;

export default appConfig;
