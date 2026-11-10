// SPDX-License-Identifier: Apache-2.0
/**
 * 模型协议支持：Responses 协议选项/提示、协议切换时的地址提示，以及
 * 「各服务商协议支持」静态矩阵。
 *
 * 矩阵是**静态核对表**，不做实时探测：每次进设置页都发请求既慢又会让服务商限流。
 * 核对日期写在表尾与列里（2026-11-09），模型名与端点可能随厂商迭代变化。
 *
 * 协议下拉的说明**不再枚举"谁不支持"**：那种枚举总是漏（2026-11-07 那版把 DeepSeek、
 * MiniMax、千帆、星火全写错了），一律指向上面的矩阵。
 */
const llmProtocol = {
  /** 协议下拉的第三项（前两项在 llmRecord 包：OpenAI 兼容 / Anthropic 原生）。 */
  "llmProtocol.protocol.responses": "OpenAI Responses（实验性）",
  /** 协议字段 tooltip 的追加说明（在 llmRecord.hint.protocol 之后另起一行）。 */
  "llmProtocol.hint.protocolExtra":
    "各服务商对三种协议的支持面不同，以「各服务商协议支持」矩阵为准。",
  /** Anthropic 原生协议的补充说明（T10：新代际改用自适应思考）。 */
  "llmProtocol.hint.anthropicAdaptive":
    "Claude 4.7 及以后使用自适应思考（effort），不再使用思考预算。",
  /** 选中 Responses 时表单里的提示条标题。 */
  "llmProtocol.alert.responsesTitle": "Responses 是实验性协议",
  /** 选中 Responses 时表单里的提示条正文：支持面看矩阵 + 切换地址的范围。 */
  "llmProtocol.alert.responsesDescription":
    "多数服务商已支持，具体以「各服务商协议支持」矩阵为准。切换协议时只会改写声明了该协议的预设的服务地址。",
  /** 协议切到 Responses 且地址被自动改写时的 Toast（成功提示必须含对象）。 */
  "llmProtocol.toast.baseUrlSwitched": "已切换到该服务商的 Responses 地址",
  /** 协议切到 Anthropic 原生且地址被自动改写时的 Toast。 */
  "llmProtocol.toast.anthropicBaseUrlSwitched": "已切换到该服务商的 Anthropic 地址",
  /** 从 Responses / Anthropic 切回 OpenAI 兼容、地址被还原时的 Toast。 */
  "llmProtocol.toast.chatBaseUrlRestored": "已还原为该服务商的对话补全地址",

  // ── 各服务商协议支持矩阵（静态核对表） ─────────────────────
  /** 展开矩阵的入口文案。 */
  "llmProtocol.matrix.toggle": "查看各服务商协议支持",
  /** 列头：服务商。 */
  "llmProtocol.matrix.provider": "服务商",
  /** 列头：对话补全协议。 */
  "llmProtocol.matrix.chat": "对话补全（Chat Completions）",
  /** 列头：Responses 协议。 */
  "llmProtocol.matrix.responses": "Responses 协议",
  /** 列头：Anthropic Messages 协议。 */
  "llmProtocol.matrix.anthropic": "Anthropic Messages 协议",
  /** 列头：核对日期。 */
  "llmProtocol.matrix.verifiedAt": "核对日期",
  /** 支持。 */
  "llmProtocol.matrix.yes": "支持",
  /** 不支持。 */
  "llmProtocol.matrix.no": "不支持",
  /** 部分支持（另有前置条件或另有入口）。 */
  "llmProtocol.matrix.partial": "部分支持",
  /** 表尾：核对日期、免责说明，以及「思考开关」指向（第 11 条）。 */
  "llmProtocol.matrix.footnote":
    "核对日期 2026-11-09，以各厂商官方文档为准；「不支持」指官方文档未提供该协议入口。模型名与端点可能变化。思考开关另见：部分型号强制思考（GPT-6 Astra / GPT-6.1 Sol / GLM-5.3 / Kimi K3 / MiniMax M3.1-Flash），本应用不会给它们发送关闭参数，设置页会把「思考模式」置灰并说明原因。",
  /** 豆包 Anthropic 单元格的说明：官方没有 Messages 入口（清单 §11.4 第 7 类缺陷）。 */
  "llmProtocol.matrix.doubaoAnthropicNote":
    "官方文档没有 Anthropic Messages 入口（兼容层只覆盖 OpenAI 兼容协议）；请改用对话补全或 Responses。",
  /** MiniMax 单元格的说明：官方文档域名与国内平台域名（Key 与域名绑定）。 */
  "llmProtocol.matrix.minimaxNote":
    "官方文档（platform.minimax.io）的入口是 api.minimax.io，预设已对齐该域名；国内平台是 api.minimaxi.com，Key 与域名绑定，国内账号需手动改回。",
  /** DeepSeek Anthropic 单元格的说明：入口在独立前缀下，与 chat 地址不同。 */
  "llmProtocol.matrix.deepseekAnthropicNote":
    "官方 Anthropic 兼容入口：https://api.deepseek.com/anthropic/v1（拼 /messages）。",
  /** Claude 对话补全单元格的说明。 */
  "llmProtocol.matrix.claudeChatNote":
    "OpenAI SDK 兼容层，官方明确仅供测试/对比、非生产就绪；完整能力请用原生协议。",
  /** 通义千问 Responses 单元格的说明：qwen-plus 只算基础兼容。 */
  "llmProtocol.matrix.qwenResponsesNote":
    "官方 Responses 支持列表未含 qwen-plus：仅基础兼容、内置工具受限；完整能力请改用 qwen3.7-plus / qwen3.8-max。",
  /** 硅基流动 Responses 单元格的说明：官方无该端点。 */
  "llmProtocol.matrix.siliconflowResponsesNote":
    "官方文档未提供 Responses 端点，实测 /v1/responses 返回 404。",
  /** 硅基流动 Anthropic 单元格的说明。 */
  "llmProtocol.matrix.siliconflowAnthropicNote": "官方入口与 chat 同址，路径为 /v1/messages。",
  /** Gemini 对话补全单元格的说明：兼容层仍是 beta，且没有 Responses。 */
  "llmProtocol.matrix.geminiChatNote":
    "OpenAI 兼容层仍为 beta（官方说明）；同一层还覆盖 embeddings / images / batches，但没有 Responses 入口。",
  /** 星火 Anthropic 单元格的说明：入口在新 MaaS 域名下，与 chat 的 /v2 不同路径。 */
  "llmProtocol.matrix.sparkAnthropicNote":
    "Anthropic/Responses 入口在新 MaaS 域名 maas-api.cn-huabei-1.xf-yun.com 下（/anthropic/v1/messages），旧 spark-api-open 域名只有 Chat Completions。",
  /** Groq Responses 单元格的说明。 */
  "llmProtocol.matrix.groqResponsesNote":
    "Responses 目前是 Beta；store 仅支持 false/null，previous_response_id 恒为 null。",
  /** Mistral Responses 单元格的说明。 */
  "llmProtocol.matrix.mistralResponsesNote": "Responses 目前是 Public Preview。",
  /** 阶跃星辰 Anthropic 单元格的补充说明。 */
  "llmProtocol.matrix.stepfunNote":
    "Anthropic 走同一主机的根域 + /v1/messages；Step Plan 为订阅制，另有 /step_plan 通道。",
  /** 阶跃星辰 Responses 单元格的说明：只有两款模型可用。 */
  "llmProtocol.matrix.stepfunResponsesNote": "当前仅支持 step-5-preview 与 step-3.7-flash。",
  /** xAI Anthropic 单元格的说明：官方已废弃兼容，迁移到 Responses。 */
  "llmProtocol.matrix.xaiAnthropicNote":
    "官方已废弃 Anthropic 兼容入口；请迁移到 Responses 协议（4.3 以后只能降 effort、不能关闭思考）。",
  /** Together AI Anthropic 单元格的补充说明。 */
  "llmProtocol.matrix.togetherAnthropicNote":
    "Messages 仅覆盖 GLM-5.2 / GLM-5.3 等部分 serverless 模型，其他模型可能返回畸形输出。",
  /** Together AI Responses 单元格的补充说明：无状态。 */
  "llmProtocol.matrix.togetherResponsesNote":
    "仅 serverless 模型；不支持 store / previous_response_id（无状态）。",
  /** Ollama Responses 单元格的版本前置条件。 */
  "llmProtocol.matrix.ollamaNote": "需 Ollama 0.13.3 及以上。",
  /** Ollama Anthropic 单元格的版本前置条件。 */
  "llmProtocol.matrix.ollamaAnthropicNote": "需 Ollama 0.14.0 及以上。",
  /** LM Studio Responses 单元格的版本前置条件。 */
  "llmProtocol.matrix.lmstudioNote": "需 LM Studio 0.3.29 及以上。",
  /** LM Studio Anthropic 单元格的版本前置条件。 */
  "llmProtocol.matrix.lmstudioAnthropicNote": "需 LM Studio 0.4.1 及以上。",
  /** Perplexity 对话补全单元格的说明。 */
  "llmProtocol.matrix.perplexityNote":
    "Sonar Chat Completions 已于 2026-09-27 停止；OpenAI 兼容的对话补全走 Agent API（/v1/sonar），本应用请改用 Responses（/v1/responses）。",
  /** Perplexity Anthropic 单元格的说明：Orchestrator 私有预览。 */
  "llmProtocol.matrix.perplexityAnthropicNote":
    "Orchestrator API（原 Router）私有预览，需申请；入口在 /orchestrator/v1，不在 /v1 下。",
  /** Azure OpenAI 一行：Responses 可用，但鉴权方式不同、本批不内置。 */
  "llmProtocol.matrix.azure": "Azure OpenAI（v1 接口，暂不内置）",
  /** Azure OpenAI Anthropic 单元格的说明：资源本身无 Messages 入口。 */
  "llmProtocol.matrix.azureAnthropicNote":
    "Azure OpenAI 资源无 Messages 入口；Microsoft Foundry 的 Claude 另有 /anthropic/v1/messages。",

  // ── 新增厂商预设名（其余 16 家的预设名沿用 appConfig.preset.*） ──
  /** 腾讯混元。 */
  "llmProtocol.preset.hunyuan": "腾讯混元",
  /** 百度千帆（文心）。 */
  "llmProtocol.preset.qianfan": "百度千帆（文心）",
  /** 讯飞星火。 */
  "llmProtocol.preset.spark": "讯飞星火",
  /** 阶跃星辰。 */
  "llmProtocol.preset.stepfun": "阶跃星辰",
  /** Together AI。 */
  "llmProtocol.preset.together": "Together AI（模型托管）",
  /** Perplexity。 */
  "llmProtocol.preset.perplexity": "Perplexity（联网问答）",
} as const;

export default llmProtocol;
