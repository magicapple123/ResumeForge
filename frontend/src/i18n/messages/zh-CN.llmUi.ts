// SPDX-License-Identifier: Apache-2.0
/**
 * 模型配置弹窗里与具体记录无关的共享控件文案：思考模式区、模型目录拉取与选模型弹窗。
 */
const llmUi = {
  "llmUi.thinking.field.mode": "思考模式",
  "llmUi.thinking.tooltip.mode":
    "开启后，AI 对话与简历生成会请求模型先思考再作答——回答更有深度，但每轮都会多一段思考时间；岗位识别、匹配分析等结构化任务不受影响（自动跳过思考以保证速度）。默认关闭；各家对思考参数的写法与档位都不一样，可以先点右边的按钮检测。",
  "llmUi.thinking.switch.on": "开启",
  "llmUi.thinking.switch.off": "关闭",
  "llmUi.thinking.field.effort": "思考强度",
  "llmUi.thinking.placeholder.customEffort": "如 xhigh / max / 4096",
  "llmUi.thinking.action.usePresets": "用预设档位",
  "llmUi.thinking.option.custom": "自定义…",
  "llmUi.thinking.placeholder.defaultEffort": "默认档位（不指定）",
  "llmUi.thinking.field.support": "支持情况",
  "llmUi.thinking.tooltip.support":
    "上游没有「查询思考能力」的接口，所以这里分两步：只读内置表给出候选档位，点按钮则真的发一次最小请求——用来分辨「真的生效 / 被静默忽略 / 被上游拒绝」。",
  "llmUi.thinking.action.probe": "检测思考支持",
  "llmUi.thinking.note.probe":
    "「检测思考支持」会发一次最小请求，计入你的模型用量。思考模式只作用于除「求职助手」以外的 AI 调用；助手的思考强度在求职助手输入框的「思考强度」里单独设置。",
  "llmUi.catalog.error.baseUrlRequired": "请先填写 Base URL，再获取可用模型",
  "llmUi.catalog.message.fetched": "获取到 {count} 个模型",
  "llmUi.catalog.message.empty":
    "没有获取到可用模型，请检查 Base URL 与 API Key 后重试；也可以手动填写模型名。",
  "llmUi.catalog.error.fetchFailed": "获取模型列表失败，请重试",
  "llmUi.catalog.field.model": "模型名称",
  "llmUi.catalog.tooltip.model": "按当前账号获取可用模型，也可以照服务商文档手动填写模型名",
  "llmUi.catalog.action.fetch": "获取可用模型",
  "llmUi.catalog.action.retry": "重试",
  "llmUi.catalog.validation.required": "必填",
  "llmUi.picker.title": "选择模型",
  "llmUi.picker.action.use": "使用",
} as const;

export default llmUi;
