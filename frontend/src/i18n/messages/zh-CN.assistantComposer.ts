// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手的输入区：上下文选择、引用条、附件、技能下拉与思考强度。
 *
 * 思考强度的档位值（""/none/low/medium/high）是**协议值**，档位清单仍由
 * `types/assistant.ts` 的 `REASONING_EFFORT_OPTIONS` 单一来源提供；这里只补一张
 * 「协议值 → 语言包 key」的表，在渲染处 `t()`，types 一个字都没改。
 *
 * 注意 `effort.off`（关闭 = 不使用思考）与 `common.action.close`（关闭窗口）是两个意思，
 * 不能复用同一个 key。
 */
const assistantComposer = {
  "assistantComposer.dropHint": "松开即可把文件加进对话",
  "assistantComposer.toast.rejectedCount": "已忽略 {count} 个不支持的附件",
  "assistantComposer.aria.jobSelect": "选择关联岗位",
  "assistantComposer.placeholder.job": "关联岗位（输入关键词搜索）",
  "assistantComposer.aria.resumeSelect": "选择关联简历",
  "assistantComposer.placeholder.resume": "关联简历（输入关键词搜索）",
  "assistantComposer.quote.user": "引用你的消息",
  "assistantComposer.quote.assistant": "引用助手的回复",
  "assistantComposer.aria.clearQuote": "取消引用",
  "assistantComposer.notice.attachments": "已选择的附件或个人资料会发送给当前配置的模型服务",
  "assistantComposer.aria.remove": "移除附件 {name}",
  "assistantComposer.action.remove": "移除",
  "assistantComposer.action.attach": "附件",
  "assistantComposer.aria.attach": "添加附件",
  "assistantComposer.tooltip.attach": "添加文本、图片或文档附件（也可以直接粘贴截图）",
  "assistantComposer.tooltip.attachCompact": "添加图片或文档附件",
  "assistantComposer.placeholder.content": "输入求职、岗位、简历或项目经历相关问题",
  "assistantComposer.skills.label": "技能",
  "assistantComposer.skills.count": "技能（{count}）",
  "assistantComposer.skills.hint": "勾选要启用的技能",
  "assistantComposer.skills.manage": "打开工作台",
  "assistantComposer.skills.toggleHint": "点击开关助手技能；勾选表示已启用",
  "assistantComposer.toggle.webSearch": "联网搜索",
  "assistantComposer.effort.label": "思考强度",
  "assistantComposer.effort.hint":
    "有思考模式的大模型可以在这里调推理强度。各家档位词汇不同（low/medium/high、minimal、xhigh、max…），选「自定义…」可以自己填；不支持该参数的服务商会忽略它，被拒绝时还会自动去掉重试一次",
  "assistantComposer.effort.default": "默认",
  "assistantComposer.effort.off": "关闭",
  "assistantComposer.effort.low": "低",
  "assistantComposer.effort.medium": "中",
  "assistantComposer.effort.high": "高",
  "assistantComposer.effort.custom": "自定义…",
  "assistantComposer.aria.effortHint": "思考强度说明",
  "assistantComposer.aria.customEffort": "自定义思考强度",
  "assistantComposer.placeholder.customEffort": "如 xhigh / max / 4096",
  "assistantComposer.action.usePreset": "用预设",
  "assistantComposer.action.stop": "停止",
  "assistantComposer.aria.stop": "停止生成",
  "assistantComposer.action.send": "发送",
  "assistantComposer.aria.send": "发送消息",
} as const;

export default assistantComposer;
