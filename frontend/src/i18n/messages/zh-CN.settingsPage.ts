// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的页面级文案：页头、九个分组、三档导航标题、搜索与各分组说明。
 *
 * 独立命名空间而不是塞进 `zh-CN.ts`：那个文件是 500 行零豁免硬预算，只剩 40 余行，
 * 而页面说明这类长句最占行。`settings.locale.*` 在 core、`settings.provenance.*` 在
 * provenance 包，本文件只放页面骨架自身的文案，不与它们重叠。
 *
 * 九组的分法按"你改的是什么"：AI 与助手（模型 → 助手行为 → 记忆与技能 → 语音与面试）
 * → 界面与操作（外观与语言 → 操作习惯）→ 数据与应用（数据与存储 → 备份与隐私 → 更新与帮助）。
 */
const settingsPage = {
  "settings.page.title": "设置",
  "settings.page.subtitle": "配置简历生成、岗位需求解读和求职助手等 AI 功能使用的模型服务",
  "settings.nav.aria": "设置分组",
  "settings.nav.group.ai": "AI 与助手",
  "settings.nav.group.interface": "界面与操作",
  "settings.nav.group.data": "数据与应用",
  "settings.tab.model": "AI 模型",
  "settings.tab.assistant": "助手行为",
  "settings.tab.memorySkills": "记忆与技能",
  "settings.tab.voice": "语音与面试",
  "settings.tab.appearance": "外观与语言",
  "settings.tab.interaction": "操作习惯",
  "settings.tab.data": "数据与存储",
  "settings.tab.backup": "备份与隐私",
  "settings.tab.about": "更新与帮助",
  "settings.search.placeholder": "搜索设置项",
  "settings.search.empty": "没有匹配的设置项",
  // 口头词别名：只给标题里没有用户说法的那几张卡（见 settingsIndex.ts 的口径）。
  "settings.search.alias.model-config": "密钥 Key 地址 Base URL 温度 超时 服务商",
  "settings.search.alias.model-window": "上下文 窗口长度 tokens 上限",
  "settings.search.alias.embedding": "向量 RAG 向量库 本地模型",
  "settings.search.alias.asr": "听写 识别 转写服务",
  "settings.search.alias.interview-voice": "音色 语速 断句 自动发送",
  "settings.search.alias.interview-camera": "摄像头 录像 面试录制",
  "settings.search.alias.datasets": "导入 导出 切换数据集",
  "settings.search.alias.storage": "磁盘 体积 清理 缓存",
  "settings.search.alias.shortcuts": "键盘 组合键 按键",
  "settings.search.alias.manual-backup": "快照 恢复 备份包",
  "settings.model.intro":
    "简历生成、岗位解读与求职助手用的是同一套模型配置，所有数据集共用；已保存的配置以记录卡片展示，点「新建配置」或记录卡上的「编辑」在弹窗中填写。",
  "settings.model.group.title": "模型与用量",
  "settings.model.group.hint": "所有数据集共用；保存后立即生效",
  "settings.assistant.intro":
    "助手能查什么、会不会放宽限制、最多跑几轮、能用哪些工具，以及投投悬浮球与网申填表时它能多做多少。这几项只影响助手，不改模型配置。",
  "settings.assistant.group.title": "助手能力",
  "settings.assistant.group.hint": "只影响助手与网申行为，不改模型配置",
  "settings.memorySkills.intro":
    "助手记住哪些求职事实、什么时候主动建任务卡，以及它能读哪些技能。记忆与技能都跟着当前数据集走。",
  "settings.voice.intro":
    "语音转写服务、实时通话的音色与节奏，以及面试时的镜头。这些参数存在本机，不随数据集切换。",
  "settings.appearance.intro":
    "界面语言、简历导出用的字体、侧栏入口与投投悬浮球。这几项都是「看着它、点着它」的设置，改完即时生效。",
  "settings.appearance.group.title": "语言、字体与导航",
  "settings.appearance.group.hint": "主题在页头切换；以下三项同级，改动即时生效",
  "settings.interaction.intro": "快捷键，以及批量生成与批量导出共用的那套参数。改完即时生效。",
  "settings.app.theme.note":
    "主题用「主题」开关切换；深色作用于应用界面与简历预览（纸面一起变深），导出的 PDF / Word 与打印结果仍是白纸。",
  "settings.data.intro":
    "岗位、简历与资料都存放在当前数据集里，可以整份导出备份或切换；顺带看数据目录占了多少地方。",
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
