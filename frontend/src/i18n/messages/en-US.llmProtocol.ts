// SPDX-License-Identifier: Apache-2.0
/**
 * Model protocols: the experimental Responses option and its hints, the Base URL switch
 * toasts, and the static provider support matrix.
 *
 * The matrix is a static, manually verified table -- it never probes providers at runtime,
 * because doing so on every settings visit would be slow and would trip rate limits. The
 * verification date (2026-11-08) is shown both in the header and in the footnote; model
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
  /** Table footnote: verification date and disclaimer. */
  "llmProtocol.matrix.footnote":
    "Verified on 2026-11-08 against each provider's official docs; model names and endpoints may change.",
  /** Note on DeepSeek's Anthropic cell: its endpoint sits under a dedicated prefix. */
  "llmProtocol.matrix.deepseekAnthropicNote":
    "Official Anthropic-compatible endpoint: https://api.deepseek.com/anthropic/v1 (append /messages).",
  /** Note on Claude's chat completions cell. */
  "llmProtocol.matrix.claudeChatNote":
    "OpenAI SDK compatibility layer, for testing only; use the native protocol for full capability.",
  /** Note on SiliconFlow's Anthropic cell. */
  "llmProtocol.matrix.siliconflowAnthropicNote":
    "Official endpoint shares the chat host; path is /v1/messages.",
  /** Note on Groq's Responses cell. */
  "llmProtocol.matrix.groqResponsesNote": "Responses is currently in Beta.",
  /** Note on Mistral's Responses cell. */
  "llmProtocol.matrix.mistralResponsesNote": "Responses is currently in Public Preview.",
  /** Note on StepFun's Anthropic cell. */
  "llmProtocol.matrix.stepfunNote":
    "Anthropic uses /v1/messages on the same Base URL; Step Plan has a separate /step_plan channel.",
  /** Note on Together AI's Anthropic cell. */
  "llmProtocol.matrix.togetherAnthropicNote":
    "Messages / Responses currently cover only some serverless models.",
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
    "Sonar Chat Completions was retired on 2026-09-27; chat now goes through the Agent API.",
  /** Azure OpenAI row: Responses works, but the auth header differs, so it is not built in. */
  "llmProtocol.matrix.azure": "Azure OpenAI (custom auth header; not built in)",

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
