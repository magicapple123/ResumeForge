// SPDX-License-Identifier: Apache-2.0
/**
 * Model protocols: the experimental Responses option and its hints, the Base URL switch
 * toasts, and the static provider support matrix.
 *
 * The matrix is a static, manually verified table -- it never probes providers at runtime,
 * because doing so on every settings visit would be slow and would trip rate limits. The
 * verification date (2026-11-09) is shown both in the header and in the footnote; model
 * names and endpoints may change.
 *
 * The protocol hint no longer enumerates who does NOT support what: that enumeration always
 * goes stale (the 2026-11-07 version was wrong for DeepSeek, MiniMax, Qianfan and Spark),
 * so it points at the matrix instead.
 */
const llmProtocol = {
  /** Third option in the protocol select (the first two live in the llmRecord pack). */
  "llmProtocol.protocol.responses": "OpenAI Responses (experimental)",
  /** Appended to the protocol tooltip, on its own line after llmRecord.hint.protocol. */
  "llmProtocol.hint.protocolExtra":
    "Each provider supports a different subset; see the protocol support matrix below.",
  /** Extra note for the native Anthropic protocol (T10: adaptive thinking in new generations). */
  "llmProtocol.hint.anthropicAdaptive":
    "Claude 4.7 and later use adaptive thinking (effort) instead of a thinking budget.",
  /** Title of the inline note shown when Responses is selected. */
  "llmProtocol.alert.responsesTitle": "Responses is an experimental protocol",
  /** Body of that note: point at the matrix, and say what switching the protocol changes. */
  "llmProtocol.alert.responsesDescription":
    "Most providers support it; check the protocol support matrix below for each one. Switching the protocol only rewrites the Base URL of presets that declare it.",
  /** Toast shown after the Base URL is rewritten for a provider that supports Responses. */
  "llmProtocol.toast.baseUrlSwitched": "Switched to this provider's Responses endpoint",
  /** Toast shown after the Base URL is rewritten for a provider's Anthropic endpoint. */
  "llmProtocol.toast.anthropicBaseUrlSwitched": "Switched to this provider's Anthropic endpoint",
  /** Toast shown when switching back to OpenAI compatible restores the chat address. */
  "llmProtocol.toast.chatBaseUrlRestored": "Restored this provider's chat completions endpoint",

  // -- Provider protocol support matrix (static, manually verified) --
  /** Label of the collapse that reveals the matrix. */
  "llmProtocol.matrix.toggle": "View protocol support by provider",
  /** Column header: provider. */
  "llmProtocol.matrix.provider": "Provider",
  /** Column header: chat completions protocol. */
  "llmProtocol.matrix.chat": "Chat Completions",
  /** Column header: Responses protocol. */
  "llmProtocol.matrix.responses": "Responses",
  /** Column header: Anthropic Messages protocol. */
  "llmProtocol.matrix.anthropic": "Anthropic Messages",
  /** Column header: verification date. */
  "llmProtocol.matrix.verifiedAt": "Verified on",
  /** Supported. */
  "llmProtocol.matrix.yes": "Supported",
  /** Not supported. */
  "llmProtocol.matrix.no": "Not supported",
  /** Partially supported (extra prerequisite or a separate endpoint). */
  "llmProtocol.matrix.partial": "Partial",
  /** Table footnote: verification date, disclaimer, and the pointer to thinking controls. */
  "llmProtocol.matrix.footnote":
    'Verified on 2026-11-09 against each provider\'s official docs; "Not supported" means the provider does not document such an endpoint. Model names and endpoints may change. Thinking controls: some models always think (GPT-6 Astra / GPT-6.1 Sol / GLM-5.3 / Kimi K3 / MiniMax M3.1-Flash); the app never sends them a disable parameter and greys out the Thinking switch with the reason.',
  /** Note on Doubao's Anthropic cell: no official Messages endpoint (issue §11.4 defect 7). */
  "llmProtocol.matrix.doubaoAnthropicNote":
    "The official docs list no Anthropic Messages endpoint (the compatibility layer covers only the OpenAI-compatible protocol); use Chat Completions or Responses instead.",
  /** Note on the MiniMax row: the documented host vs the mainland platform host. */
  "llmProtocol.matrix.minimaxNote":
    "The documented entry is api.minimax.io and the preset now uses it; the mainland platform is api.minimaxi.com. Keys are bound to their host, so mainland accounts should switch it back.",
  /** Note on DeepSeek's Anthropic cell: its endpoint sits under a dedicated prefix. */
  "llmProtocol.matrix.deepseekAnthropicNote":
    "Official Anthropic-compatible endpoint: https://api.deepseek.com/anthropic/v1 (append /messages).",
  /** Note on Claude's chat completions cell. */
  "llmProtocol.matrix.claudeChatNote":
    "OpenAI SDK compatibility layer, documented for testing/comparison only and not production-ready; use the native protocol for full capability.",
  /** Note on Qwen's Responses cell: qwen-plus is basic compatibility only. */
  "llmProtocol.matrix.qwenResponsesNote":
    "The official Responses support list excludes qwen-plus: basic compatibility only, with built-in tools limited. Use qwen3.7-plus / qwen3.8-max for full capability.",
  /** Note on SiliconFlow's Responses cell: no such endpoint. */
  "llmProtocol.matrix.siliconflowResponsesNote":
    "No Responses endpoint is documented; /v1/responses returns 404 in practice.",
  /** Note on SiliconFlow's Anthropic cell. */
  "llmProtocol.matrix.siliconflowAnthropicNote":
    "Official endpoint shares the chat host; path is /v1/messages.",
  /** Note on Gemini's chat completions cell: the compat layer is beta and has no Responses. */
  "llmProtocol.matrix.geminiChatNote":
    "The OpenAI compatibility layer is still beta; it also covers embeddings / images / batches, but has no Responses endpoint.",
  /** Note on Spark's Anthropic cell: entry lives on the new MaaS host, unlike chat under /v2. */
  "llmProtocol.matrix.sparkAnthropicNote":
    "Anthropic / Responses entries live on the new MaaS host maas-api.cn-huabei-1.xf-yun.com (/anthropic/v1/messages); the legacy spark-api-open host only serves Chat Completions.",
  /** Note on Groq's Responses cell. */
  "llmProtocol.matrix.groqResponsesNote":
    "Responses is in Beta; store accepts only false/null and previous_response_id is always null.",
  /** Note on Mistral's Responses cell. */
  "llmProtocol.matrix.mistralResponsesNote": "Responses is currently in Public Preview.",
  /** Note on StepFun's Anthropic cell. */
  "llmProtocol.matrix.stepfunNote":
    "Anthropic uses the same host root + /v1/messages; Step Plan is subscription-only and has a separate /step_plan channel.",
  /** Note on StepFun's Responses cell: only two models are available. */
  "llmProtocol.matrix.stepfunResponsesNote":
    "Currently supports only step-5-preview and step-3.7-flash.",
  /** Note on xAI's Anthropic cell: the compatibility entry is deprecated; migrate to Responses. */
  "llmProtocol.matrix.xaiAnthropicNote":
    "The official Anthropic compatibility entry is deprecated; migrate to the Responses protocol (4.5 and later can only lower effort, not disable thinking).",
  /** Note on Together AI's Anthropic cell. */
  "llmProtocol.matrix.togetherAnthropicNote":
    "Messages covers only some serverless models such as GLM-5.2 / GLM-5.3; other models may return malformed output.",
  /** Note on Together AI's Responses cell: stateless. */
  "llmProtocol.matrix.togetherResponsesNote":
    "Serverless models only; store / previous_response_id are not supported (stateless).",
  /** Version prerequisite on Ollama's Responses cell. */
  "llmProtocol.matrix.ollamaNote": "Requires Ollama 0.13.3 or later.",
  /** Version prerequisite on Ollama's Anthropic cell. */
  "llmProtocol.matrix.ollamaAnthropicNote": "Requires Ollama 0.14.0 or later.",
  /** Version prerequisite on LM Studio's Responses cell. */
  "llmProtocol.matrix.lmstudioNote": "Requires LM Studio 0.3.29 or later.",
  /** Version prerequisite on LM Studio's Anthropic cell. */
  "llmProtocol.matrix.lmstudioAnthropicNote": "Requires LM Studio 0.4.1 or later.",
  /** Note on Perplexity's chat completions cell. */
  "llmProtocol.matrix.perplexityNote":
    "Sonar Chat Completions ended on 2026-09-27; OpenAI-compatible chat now goes through the Agent API (/v1/sonar). Use Responses (/v1/responses) in this app.",
  /** Note on Perplexity's Anthropic cell: Orchestrator is a private preview. */
  "llmProtocol.matrix.perplexityAnthropicNote":
    "Orchestrator API (formerly Router) is in private preview and requires approval; the entry is /orchestrator/v1, not under /v1.",
  /** Azure OpenAI row: Responses works, but the auth header differs, so it is not built in. */
  "llmProtocol.matrix.azure": "Azure OpenAI (v1 API; not built in)",
  /** Note on Azure OpenAI's Anthropic cell: the resource itself has no Messages endpoint. */
  "llmProtocol.matrix.azureAnthropicNote":
    "Azure OpenAI resources have no Messages endpoint; Claude on Microsoft Foundry has a separate /anthropic/v1/messages.",

  // -- Display names for the newly added vendor presets --
  /** Tencent Hunyuan. */
  "llmProtocol.preset.hunyuan": "Tencent Hunyuan",
  /** Baidu Qianfan (ERNIE). */
  "llmProtocol.preset.qianfan": "Baidu Qianfan (ERNIE)",
  /** iFlytek Spark. */
  "llmProtocol.preset.spark": "iFlytek Spark",
  /** StepFun. */
  "llmProtocol.preset.stepfun": "StepFun",
  /** Together AI. */
  "llmProtocol.preset.together": "Together AI",
  /** Perplexity. */
  "llmProtocol.preset.perplexity": "Perplexity",
} as const;

export default llmProtocol;
