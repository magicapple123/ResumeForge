// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的页面级文案：页头、三个页签、各分组标题与说明。
 *
 * 独立命名空间而不是塞进 `zh-CN.ts`：那个文件是 500 行零豁免硬预算，只剩 40 余行，
 * 而页面说明这类长句最占行。`settings.locale.*` 在 core、`settings.provenance.*` 在
 * provenance 包，本文件只放页面骨架自身的文案，不与它们重叠。
 */
const settingsPage = {
  "settings.page.title": "设置",
  "settings.page.subtitle": "配置简历生成、岗位需求解读和求职助手等 AI 功能使用的模型服务",
  "settings.tab.model": "AI 模型",
  "settings.tab.data": "数据",
  "settings.tab.app": "应用",
  "settings.model.intro":
    "简历生成、岗位解读与求职助手用的是同一套模型配置，所有数据集共用；已保存的配置以记录卡片展示，点「新建配置」或记录卡上的「编辑」在弹窗中填写。",
  "settings.model.group.title": "大模型 API 配置（所有数据集共用）",
  "settings.model.group.hint": "保存即对所有数据集生效；记录卡片可随时切换「使用中」",
  "settings.assistant.group.title": "助手能力",
  "settings.assistant.group.hint": "助手能查什么、会什么、能读什么",
  "settings.data.intro": "岗位、简历与资料都存放在当前数据集里，可以整份导出备份或切换。",
  "settings.app.intro": "应用本身的版本、更新与提醒行为。",
  "settings.app.ui.title": "界面与提醒",
  "settings.app.ui.hint": "导航入口、快捷键、悬浮球与近期提醒的行为",
  "settings.app.theme.note":
    "主题用「主题」开关切换；深色只作用于应用界面，简历预览、导出 PDF 与打印结果仍是白纸。",
  "settings.webform.title": "网申填表",
  "settings.webform.hint": "网申填表时 AI 能多做多少",
  "settings.help.title": "更新与帮助",
  "settings.help.hint": "版本更新、诊断与反馈入口",
} as const;

export default settingsPage;
