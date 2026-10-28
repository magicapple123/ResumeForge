// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的页面级文案：页头、六个页签、各分组标题与说明。
 *
 * 独立命名空间而不是塞进 `zh-CN.ts`：那个文件是 500 行零豁免硬预算，只剩 40 余行，
 * 而页面说明这类长句最占行。`settings.locale.*` 在 core、`settings.provenance.*` 在
 * provenance 包，本文件只放页面骨架自身的文案，不与它们重叠。
 *
 * 六页的分法按"你改的是什么"：先 AI 能力怎么配（model → assistant），再界面怎么用
 * （appearance），再数据怎么存怎么保（data → backup），最后应用本身（about）。
 */
const settingsPage = {
  "settings.page.title": "设置",
  "settings.page.subtitle": "配置简历生成、岗位需求解读和求职助手等 AI 功能使用的模型服务",
  "settings.tab.model": "AI 模型",
  "settings.tab.assistant": "助手与 AI 行为",
  "settings.tab.appearance": "外观与交互",
  "settings.tab.data": "数据与导出",
  "settings.tab.backup": "备份与隐私",
  "settings.tab.about": "更新与帮助",
  "settings.model.intro":
    "简历生成、岗位解读与求职助手用的是同一套模型配置，所有数据集共用；已保存的配置以记录卡片展示，点「新建配置」或记录卡上的「编辑」在弹窗中填写。",
  "settings.model.group.title": "模型与用量",
  "settings.model.group.hint": "所有数据集共用；保存后立即生效",
  "settings.assistant.intro":
    "助手能查什么、会不会放宽限制、能读哪些技能，以及投投悬浮球与网申填表时它能多做多少。这几项只影响助手，不改模型配置。",
  "settings.assistant.group.title": "助手能力",
  "settings.assistant.group.hint": "只影响助手与网申行为，不改模型配置",
  "settings.appearance.intro":
    "界面语言、简历导出用的字体、侧栏入口与快捷键。这几项都是「看着它、点着它」的设置，改完即时生效。",
  "settings.appearance.group.title": "语言、字体与导航",
  "settings.appearance.group.hint": "主题在页头切换；以下三项同级，改动即时生效",
  "settings.app.theme.note":
    "主题用「主题」开关切换；深色只作用于应用界面，简历预览、导出 PDF 与打印结果仍是白纸。",
  "settings.data.intro": "岗位、简历与资料都存放在当前数据集里，可以整份导出备份或切换。",
  "settings.backup.intro":
    "自动备份、手动快照与隐私相关的行为。这些设置管的是「数据怎么保、哪些不发出去」，与数据集本身无关。",
  "settings.about.intro": "应用本身的版本、更新、诊断与提醒行为。",
  "settings.webform.title": "网申填表",
  "settings.webform.hint": "网申填表时 AI 能多做多少",
  // 语言卡片的标题与补充说明（label / saveFailed 在 core，这里只放卡片标题、
  // 选项说明与"无需保存"的提示）。
  "settings.locale.title": "界面语言",
  "settings.locale.option.zh-CN": "界面文案、按钮与提示使用简体中文",
  "settings.locale.option.en-US": "界面文案、按钮与提示使用英文（简历内容与导出格式不受影响）",
  "settings.locale.autoSaveHint": "点一下立即生效并自动保存，不需要再点保存。",
} as const;

export default settingsPage;
