// SPDX-License-Identifier: Apache-2.0
/**
 * 模型配置记录的只读详情弹窗（点记录卡本体打开）：标题、字段标签、协议 / 密钥 /
 * 思考模式 / 高级调整的取值文案，以及拼接取值时用的两个分隔符。
 *
 * `Base URL` 与 `API Key` 两个字段标签刻意留在组件里：它们的源文本身就是英文，
 * 收进词表会被 `messageContract` 的 `source-ascii-english` 判成"源文是英文"。
 */
const llmRecordView = {
  /** 弹窗标题；{name} 是记录名。 */
  "llmRecordView.title.detail": "配置详情「{name}」",
  /** 字段标签：命中的预置服务商。 */
  "llmRecordView.field.preset": "预设",
  /** 字段标签：接口协议。 */
  "llmRecordView.field.protocol": "接口协议",
  /** 协议取值：Anthropic 原生 Messages。 */
  "llmRecordView.protocol.anthropic": "Anthropic 原生（Messages）",
  /** 协议取值：OpenAI 兼容 Chat Completions。 */
  "llmRecordView.protocol.openai": "OpenAI 兼容（Chat Completions）",
  /** 字段标签：模型名。 */
  "llmRecordView.field.model": "模型名称",
  /** 地址或模型名为空时的占位。 */
  "llmRecordView.value.empty": "未填写",
  /** 密钥已保存：只显示脱敏占位，{mask} 就是 `********`。 */
  "llmRecordView.apiKey.configured": "已配置（{mask}）",
  /** 密钥尚未保存。 */
  "llmRecordView.apiKey.notConfigured": "未配置",
  /** 字段标签：temperature。 */
  "llmRecordView.field.temperature": "创意度 temperature",
  /** 字段标签：请求超时。 */
  "llmRecordView.field.timeout": "超时时间",
  /** 超时时间的取值；{seconds} 是秒数。 */
  "llmRecordView.value.timeoutSeconds": "{seconds} 秒",
  /** 字段标签：最大输出 token。 */
  "llmRecordView.field.maxTokens": "最大输出 Token",
  /** 0 表示不发送 max_tokens，由服务商决定上限。 */
  "llmRecordView.maxTokens.unlimited": "不限制（由服务商决定上限）",
  /** 字段标签：思考模式。 */
  "llmRecordView.field.thinking": "思考模式",
  /** 思考已开启且指定了档位；{effort} 是档位值。 */
  "llmRecordView.thinking.onWithEffort": "已开启 · 档位 {effort}",
  /** 思考已开启但留空档位。 */
  "llmRecordView.thinking.onPreset": "已开启 · 不指定档位",
  /** 思考已关闭。 */
  "llmRecordView.thinking.off": "关闭",
  /** 字段标签：折叠区里的高级参数摘要。 */
  "llmRecordView.field.advanced": "高级调整",
  /** 高级参数摘要里停止词的标签。 */
  "llmRecordView.advanced.stop": "停止词",
  /** 多条停止词之间的分隔符（中文顿号，英文用 ", "）。 */
  "llmRecordView.separator.stop": "、",
  /** 多行高级参数之间的分隔符（中文全角分号，英文用 "; "）。 */
  "llmRecordView.separator.line": "；",
} as const;

export default llmRecordView;
