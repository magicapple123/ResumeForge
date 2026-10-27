// SPDX-License-Identifier: Apache-2.0
/**
 * 快捷键设置卡：动作名、作用域名、拒绝原因、「为什么不用更顺手的键」提示，以及卡片内文案。
 *
 * 动作 id 与作用域取值是**协议值**（写进 localStorage，见 `features/shortcuts/registry.ts`），
 * 本文件只提供显示名；`registry.ts` 里改成 `labelKey` 之后，那边不再有中文字面量。
 */
const shortcutSettings = {
  "shortcutSettings.card.title": "快捷键",
  "shortcutSettings.card.intro":
    "点「修改」后直接按下想要的组合，按 Esc 取消。组合键必须带 Ctrl / ⌘ 或 Alt；浏览器保留的组合（如 Ctrl+W）以及已被其它动作占用的组合会被拒绝。改动保存在本机，立即生效。",

  "shortcutSettings.action.undo": "撤回",
  "shortcutSettings.action.redo": "恢复",
  "shortcutSettings.action.save": "保存当前编辑",
  "shortcutSettings.action.search": "搜索",
  "shortcutSettings.action.assistant": "打开/关闭求职助手",
  "shortcutSettings.action.newJob": "新建岗位",
  "shortcutSettings.action.toggleTheme": "切换深色/浅色",
  "shortcutSettings.action.openSettings": "打开设置",
  "shortcutSettings.action.openSkills": "打开助手技能",
  "shortcutSettings.action.exportPdf": "打开导出（简历预览中）",
  "shortcutSettings.action.newResume": "新建简历",
  "shortcutSettings.action.switchDataset": "切换数据集",
  "shortcutSettings.action.prevPage": "上一页（列表）",
  "shortcutSettings.action.nextPage": "下一页（列表）",
  "shortcutSettings.action.focusAssistant": "打开助手并聚焦输入",
  "shortcutSettings.action.commandPalette": "打开命令面板（制作台）",

  "shortcutSettings.scope.form": "表单",
  "shortcutSettings.scope.page": "页面",
  "shortcutSettings.scope.global": "全局",
  "shortcutSettings.scope.jobs": "岗位广场",

  "shortcutSettings.reject.empty": "没听清，请再按一次组合键",
  "shortcutSettings.reject.modifierOnly": "还需要一个非修饰键（例如 Z、K）",
  "shortcutSettings.reject.reserved": "这是浏览器或窗口的保留组合，换一个",
  "shortcutSettings.reject.noModifier": "组合键必须带 Ctrl / ⌘ 或 Alt",

  "shortcutSettings.hint.toggleTheme":
    "避开 Ctrl+Shift+L（部分浏览器/扩展占用），改用 Ctrl/⌘+Alt+D。",
  "shortcutSettings.hint.openSettings":
    "Ctrl/⌘+, 是浏览器与系统的设置键，到不了页面，改用 Ctrl/⌘+Alt+S。",
  "shortcutSettings.hint.openSkills":
    "避开 Ctrl+Shift+K（浏览器开发者工具/搜索冲突），改用 Ctrl/⌘+Alt+K。",
  "shortcutSettings.hint.exportPdf": "Ctrl/⌘+E 是浏览器地址栏搜索的保留键，改用 Ctrl/⌘+Shift+E。",
  "shortcutSettings.hint.newResume":
    "避开 Ctrl/⌘+Alt+R（与输入法/扩展冲突），改用 Ctrl/⌘+Shift+N。",
  "shortcutSettings.hint.pageOnly":
    "作用于当前列表分页，不是简历预览翻页；落到分页控件上，不在预览里翻页。",

  "shortcutSettings.column.action": "动作",
  "shortcutSettings.column.scope": "作用域",
  "shortcutSettings.column.keys": "当前按键",
  "shortcutSettings.column.actions": "操作",

  "shortcutSettings.recording": "请按下新组合，Esc 取消",
  "shortcutSettings.unbound": "未绑定",
  "shortcutSettings.action.edit": "修改",
  "shortcutSettings.action.clear": "清除",
  "shortcutSettings.action.restore": "恢复默认",
  "shortcutSettings.action.resetAll": "全部恢复默认",

  "shortcutSettings.conflict": "已被「{label}」占用",
  "shortcutSettings.changed": "「{label}」已改为 {keys}",
  "shortcutSettings.unboundDone": "「{label}」已解绑，这个组合键不再触发任何动作",
  "shortcutSettings.restoredDone": "「{label}」已恢复默认",
  "shortcutSettings.resetAllDone": "已恢复默认快捷键（共 {count} 项）",

  "shortcutSettings.clearConfirm.title": "解绑「{label}」？",
  "shortcutSettings.clearConfirm.body": "解绑后这个组合键不再触发任何动作，可随时「恢复默认」。",
  "shortcutSettings.clearConfirm.ok": "解绑",
  "shortcutSettings.resetAllConfirm.title": "全部恢复默认快捷键？",
  "shortcutSettings.actionHelp": "{label} 说明",
} as const;

export default shortcutSettings;
