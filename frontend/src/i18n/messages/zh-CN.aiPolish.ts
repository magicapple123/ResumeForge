// SPDX-License-Identifier: Apache-2.0
/**
 * AI 润色浮层卡片：选中的文字、要求输入框、改写结果、继续改写、超长与未配置模型的提示。
 *
 * ## 「还没有配置大模型」那段为什么是两条 key
 *
 * 原文是「润色需要调用大模型，<Link>去设置配置模型</Link>后再回来试。」——中间那个标签是
 * **导航链接**（不是 `<b>` 这类纯修饰），不能像普通内嵌标签那样整段去标签；而 i18n 没有
 * 富文本插值，拼「前半句 + 链接 + 后半句」在英文里语序必然错位。所以拆成
 * 「一句完整的结论」+「一个完整的动作名」，两条各自成句，任何语序都读得通：
 * 「润色需要调用大模型才能工作。去设置里配置模型」。
 *
 * ## 数字都走参数
 *
 * 字数上限来自 `MAX_SELECTION_CHARS`，不要写死在文案里。
 */
const aiPolish = {
  /** 卡片标题，同时是 `role="dialog"` 的无障碍名。 */
  "aiPolish.title": "AI 润色",
  "aiPolish.privacy": "只发送选中的这段文字，不发送整份简历",
  "aiPolish.dragHint": "按住标题可以拖动卡片",

  "aiPolish.label.source": "原文",
  "aiPolish.label.selection": "选中的文字",

  "aiPolish.label.result": "改写结果（可以直接改）",
  "aiPolish.aria.result": "改写结果",

  "aiPolish.label.followUp": "继续改写要求（可选）",
  "aiPolish.aria.followUp": "继续改写要求",
  "aiPolish.placeholder.followUp": "例如：再精简一点 / 突出量化结果",

  "aiPolish.label.instruction": "你的要求（可选）",
  "aiPolish.aria.instruction": "润色要求",
  "aiPolish.placeholder.instruction": "例如：更简洁、突出成果、改成 STAR 结构",

  "aiPolish.action.start": "开始改写",
  "aiPolish.action.continue": "继续改写",
  "aiPolish.action.restart": "重新改写",
  "aiPolish.action.replace": "替换选中",

  "aiPolish.followUp.tooLong": "待改写内容超过 {limit} 字，请先手动精简",
  "aiPolish.tooLong.title": "选中的文字超过 {limit} 字",
  "aiPolish.tooLong.body": "一次只润色一段：请缩小选中范围后再试。",

  "aiPolish.modelMissing.title": "还没有配置大模型",
  "aiPolish.modelMissing.body": "润色需要调用大模型才能工作。",
  "aiPolish.modelMissing.action": "去设置里配置模型",

  "aiPolish.error.title": "润色没有完成",
  "aiPolish.error.failed": "润色失败，请稍后重试",
  "aiPolish.error.maxLength": "这个字段有字数上限，放不下这段改写。请缩短结果后再替换。",
  "aiPolish.error.targetGone": "原来的输入框已经不在了（页面可能已切换），请重新选中文字。",
} as const;

export default aiPolish;
