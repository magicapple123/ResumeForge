// SPDX-License-Identifier: Apache-2.0
/** 对话技能（T14）：输入区技能 chip / 技能菜单 / 注入预算，以及助手消息里的「本轮技能」。 */
const conversationSkills = {
  "conversationSkills.action.add": "技能",
  "conversationSkills.action.manage": "打开工作台",
  "conversationSkills.menu.hint": "只对当前对话生效；换对话各有一套",
  "conversationSkills.menu.budget": "本对话 {count} 个 · {used} / {limit} 字",
  "conversationSkills.menu.budgetPending": "本对话 {count} 个 · 发送第一条消息后开始计预算",
  "conversationSkills.menu.budgetOver": "已超预算 {over} 字，靠后的技能会被截断",
  "conversationSkills.menu.empty": "还没有技能，先到工作台新建一个",
  "conversationSkills.chip.disable": "停用技能「{name}」",
  "conversationSkills.chip.truncatedHint":
    "提示词超出本对话预算，未完整加载；精简提示词或停用其它技能后可完整生效",
  "conversationSkills.chip.truncatedCount":
    "提示词超出本对话预算，只加载了前 {loaded} 字（共 {requested} 字）",
  "conversationSkills.chip.skippedHint": "整块未加载，可先停用其它技能",
  "conversationSkills.row.aria": "本对话启用的技能",
  "conversationSkills.error.tooMany": "一个对话最多启用 8 个技能",
  "conversationSkills.message.used": "本轮技能：{names}",
  "conversationSkills.message.separator": "、",
  "conversationSkills.page.intro":
    "技能在对话里启用，不在技能库里全局开启；到求职助手输入区的技能菜单勾选即可使用。",
} as const;

export default conversationSkills;
