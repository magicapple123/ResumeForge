// SPDX-License-Identifier: Apache-2.0
/** 对话技能（T14→T24）：输入区待发送技能 chip / 技能菜单，以及用户消息里的「使用」技能。 */
const conversationSkills = {
  "conversationSkills.action.add": "技能",
  "conversationSkills.action.manage": "打开工作台",
  "conversationSkills.menu.hint": "只作用于下一条消息；发送后自动清空",
  "conversationSkills.menu.budget": "本条 {count} 个 · {used} / {limit} 字",
  "conversationSkills.menu.budgetPending": "本条 {count} 个 · 发送时按预算加载",
  "conversationSkills.menu.budgetOver": "已超预算 {over} 字，靠后的技能会被截断",
  "conversationSkills.menu.empty": "还没有技能，先到工作台新建一个",
  // #31D/#31F：自动生成但尚未验证的技能不可启用（后端 409 的前端前置提示）
  "conversationSkills.menu.pendingBadge": "〔待验证〕",
  "conversationSkills.menu.pendingHint": "待验证：先到技能页确认通过之后才能启用",
  "conversationSkills.chip.disable": "从本条移除技能「{name}」",
  "conversationSkills.chip.truncatedHint":
    "提示词超出本条消息的预算，未完整加载；精简提示词或移除其它技能后可完整生效",
  "conversationSkills.chip.truncatedCount":
    "提示词超出本条消息的预算，只加载了前 {loaded} 字（共 {requested} 字）",
  "conversationSkills.chip.skippedHint": "整块未加载，可先移除其它技能",
  "conversationSkills.row.aria": "下一条消息将使用的技能",
  "conversationSkills.error.tooMany": "一条消息最多使用 8 个技能",
  // T24：技能只作用于用户发出那一条消息（不是整段对话）。
  "conversationSkills.message.usedLabel": "使用",
  // 旧数据（T24）：这段对话在"按对话启用"时代挂过技能，现已不生效。
  "conversationSkills.legacy.notice":
    "这段对话以前启用过技能：{names}。现在技能只作用于下一条消息，需要时在输入区重新勾选。",
  "conversationSkills.legacy.dismiss": "知道了",
  "conversationSkills.page.intro":
    "技能在助手输入区勾选，只对下一条消息生效，发送后自动清空；不在技能库里全局开启。",
} as const;

export default conversationSkills;
