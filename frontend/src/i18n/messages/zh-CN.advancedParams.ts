// SPDX-License-Identifier: Apache-2.0
/**
 * 模型配置弹窗「高级调整」折叠块：留空提示、Top P / 惩罚项 / 随机种子 / 停止词的标签与
 * 说明、思考参数形态，以及协议差异的两条说明。
 */
const advancedParams = {
  "advancedParams.alert.emptyNotSent":
    "留空的参数不会发送给模型服务，由服务商使用默认值。这些参数并非所有服务商都支持，填写前请先看官方文档。",
  "advancedParams.placeholder.leaveEmpty": "留空 = 不发送",
  "advancedParams.tooltip.topP":
    "核采样：只从累计概率达到该值的候选里取词。与 temperature 叠加使用，通常只调其中一个。",
  "advancedParams.field.frequencyPenalty": "频率惩罚",
  "advancedParams.tooltip.frequencyPenalty": "-2 到 2。正值降低重复用词，负值鼓励重复。",
  "advancedParams.field.presencePenalty": "存在惩罚",
  "advancedParams.tooltip.presencePenalty": "-2 到 2。正值鼓励谈新话题，负值让模型更贴题。",
  "advancedParams.field.seed": "随机种子",
  "advancedParams.tooltip.seed": "固定种子后同一请求更容易复现相同输出；是否生效取决于服务商。",
  "advancedParams.tooltip.topK":
    "只在概率最高的 K 个候选里取词。Anthropic 与部分开源模型支持；OpenAI 官方接口会忽略它。",
  "advancedParams.field.repetitionPenalty": "重复惩罚",
  "advancedParams.tooltip.repetitionPenalty":
    "大于 1 时抑制重复用词。与「频率惩罚」作用类似但计算方式不同，通常只用其中一个。",
  "advancedParams.field.thinkingBudget": "思考预算",
  "advancedParams.tooltip.thinkingBudget":
    "Claude 原生协议下的扩展思考 token 预算。填 0 = 明确关闭思考；留空 = 不发送该字段。仅在协议选「Anthropic 原生」时有效。填了它就以上面的「思考模式」开关为准——这是给需要精确控制预算的老用法留的。",
  "advancedParams.field.thinkingStyle": "思考参数形态",
  "advancedParams.tooltip.thinkingStyle":
    "开启思考时请求体里用哪种写法。auto = 按接口协议与服务商自动推断（多数情况选这个）；只有走中转站、自建网关，或「检测思考支持」说参数不被接受时，才需要手动换一种。",
  "advancedParams.field.stop": "停止词",
  "advancedParams.tooltip.stop":
    "模型生成到这些词就停下（最多 4 条）。回车确认一条；留空 = 不发送。",
  "advancedParams.placeholder.stop": "输入后回车添加，最多 4 条",
  "advancedParams.alert.protocolNote":
    "协议换成「Anthropic 原生」后，思考预算、Top K 等参数才有意义；换成 OpenAI 兼容时它们会被忽略。思考预算与「思考模式」是同一件事的两代写法：填了预算就以预算为准，留空则由开关与强度决定。",
} as const;

export default advancedParams;
