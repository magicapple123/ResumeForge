// SPDX-License-Identifier: Apache-2.0
/**
 * 模型配置记录弹窗：名称、协议、Base URL、密钥、采样参数与高级调整。
 *
 * 含多行三元的标题与错误提示留待下一批。
 */
const llmRecord = {
  "llmRecord.title.create": "新建配置记录",
  "llmRecord.title.edit": "编辑配置记录「{name}」",
  "llmRecord.action.test": "测试连接",
  "llmRecord.action.saveRecord": "保存记录",
  "llmRecord.action.save": "保存",
  "llmRecord.field.name": "配置名称",
  "llmRecord.required.name": "请填写配置名称",
  "llmRecord.placeholder.name": "如：DeepSeek 校招、Ollama 本地模型",
  "llmRecord.field.preset": "快速预设（选择后自动填充 Base URL 与模型名）",
  "llmRecord.field.protocol": "接口协议",
  "llmRecord.hint.protocol":
    "多数服务商（含 Claude 的 OpenAI 兼容层）走 Chat Completions，选「OpenAI 兼容」。只有要用 Claude 原生 Messages 接口时才选另一项。",
  "llmRecord.protocol.openai": "OpenAI 兼容（Chat Completions）",
  "llmRecord.protocol.anthropic": "Anthropic 原生（Messages）",
  "llmRecord.required.field": "必填",
  "llmRecord.hint.baseUrl": "服务地址，通常形如 https://api.xxx.com 或 https://api.xxx.com/v1",
  "llmRecord.field.apiKeyOptional": "API Key（选填）",
  "llmRecord.field.apiKeyKeep": "API Key（留空保持不变）",
  "llmRecord.hint.apiKeyCreate":
    "多数云模型服务需要填写；Ollama 等无需鉴权的本地兼容服务可留空。密钥保存在本地数据库，仅本机可访问。",
  "llmRecord.hint.apiKeyEdit":
    "出于脱敏考虑，已保存的密钥不会显示出来（记录里只保存脱敏引用）；留空即沿用原密钥，输入新值则整体替换。",
  "llmRecord.placeholder.apiKeyKeep": "已配置，留空保持不变",
  "llmRecord.field.temperature": "创意度 temperature",
  "llmRecord.hint.temperature":
    "控制输出的随机性。值越低越稳定，适合事实型简历；值越高表达更发散，也会增加内容不一致或虚构风险。",
  "llmRecord.temperature.strict": "严谨",
  "llmRecord.temperature.balanced": "均衡",
  "llmRecord.temperature.creative": "发散",
  "llmRecord.field.timeout": "超时时间（秒）",
  "llmRecord.hint.timeout":
    "等待模型返回响应数据的最长时间；超过后请求会终止。网络较慢或生成内容较长时可适当调大，但调大不会让模型生成得更快。",
  "llmRecord.field.maxTokens": "最大输出 Token",
  "llmRecord.hint.maxTokens":
    "限制模型单次回复的最大输出 Token 数。值越大可能增加费用；过小可能导致内容被截断。它不是模型的上下文长度上限。",
  "llmRecord.aria.maxTokens": "最大输出 Token 说明",
  "llmRecord.hint.unlimited":
    "勾选后不再发送 max_tokens，由服务商决定上限。可缓解推理模型把思考过程算进输出预算、正文被挤空的问题；但它不是真的无限。",
  "llmRecord.label.unlimited": "不限制",
} as const;

export default llmRecord;
