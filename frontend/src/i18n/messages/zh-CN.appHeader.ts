// SPDX-License-Identifier: Apache-2.0
/**
 * 页头右侧的「当前数据集 + 用户头像」：数据集 chip 的无障碍名、示例徽标与提示、
 * 数据集下拉的当前项 / 回到主数据 / 新建入口、新建数据集的询问与失败反馈，以及头像入口。
 */
const appHeader = {
  "appHeader.dataset.sampleTag": "示例",
  "appHeader.dataset.sampleTagTooltip": "体验数据，与你的真实资料相互独立",
  "appHeader.dataset.chipAria": "当前数据集：{name}",
  "appHeader.dataset.chipAriaSample": "当前数据集：{name}，示例数据",
  /**
   * 主数据集（后端 `MAIN_DATASET_NAME`）的展示名。
   *
   * 它是**创建时写死的名字**、且后端拒绝改名，所以按固定文案翻译；用户自建/导入的
   * 数据集一律显示它们自己的名字（那是用户数据）。
   */
  "appHeader.dataset.mainName": "主数据",
  "appHeader.dataset.menuCurrent": "{name}（当前）",
  "appHeader.dataset.menuBackToMine": "回到我的数据",
  "appHeader.dataset.menuCreate": "新建数据集…",
  "appHeader.dataset.switchFailed": "切换数据集失败",
  "appHeader.dataset.createNameRequired": "请填写数据集名称",
  "appHeader.dataset.createSucceeded": "已新建「{name}」",
  "appHeader.dataset.createSwitchPrompt": "是否立即切换到这个数据集？",
  "appHeader.dataset.createSwitchNow": "立即切换",
  "appHeader.dataset.createSwitchLater": "稍后",
  "appHeader.dataset.createFailed": "新建数据集失败",
  "appHeader.avatar.openProfile": "进入我的资料",
  "appHeader.avatar.altWithName": "{name}的头像",
  "appHeader.avatar.altFallback": "用户头像",
  /**
   * 桌面自绘标题栏（问题清单 §19）：六个菜单、各自的菜单项与「关于」弹窗。
   * 桌面壳才渲染（浏览器版没有系统窗口控件可替换），文案仍走 i18n 以支持英文界面。
   */
  "appHeader.desktopMenu.aria": "应用菜单",
  "appHeader.desktopMenu.file": "文件",
  "appHeader.desktopMenu.edit": "编辑",
  "appHeader.desktopMenu.view": "视图",
  "appHeader.desktopMenu.window": "窗口",
  "appHeader.desktopMenu.help": "帮助",
  "appHeader.desktopMenu.about": "关于",
  "appHeader.desktopMenu.item.newResume": "新建简历…",
  "appHeader.desktopMenu.item.importDataset": "导入数据集…",
  "appHeader.desktopMenu.item.openDataDir": "打开数据目录",
  "appHeader.desktopMenu.item.backupRestore": "备份与恢复…",
  "appHeader.desktopMenu.item.quit": "退出",
  "appHeader.desktopMenu.item.undo": "撤销",
  "appHeader.desktopMenu.item.redo": "重做",
  "appHeader.desktopMenu.item.cut": "剪切",
  "appHeader.desktopMenu.item.copy": "复制",
  "appHeader.desktopMenu.item.paste": "粘贴",
  "appHeader.desktopMenu.item.selectAll": "全选",
  "appHeader.desktopMenu.item.zoomIn": "放大",
  "appHeader.desktopMenu.item.zoomOut": "缩小",
  "appHeader.desktopMenu.item.zoomReset": "实际大小",
  "appHeader.desktopMenu.item.fullscreen": "全屏",
  "appHeader.desktopMenu.item.reload": "重新加载",
  "appHeader.desktopMenu.item.toggleDevTools": "开发者工具",
  "appHeader.desktopMenu.item.alwaysOnTop": "窗口置顶",
  "appHeader.desktopMenu.item.minimize": "最小化",
  "appHeader.desktopMenu.item.maximize": "最大化",
  "appHeader.desktopMenu.item.restore": "还原",
  "appHeader.desktopMenu.item.closeWindow": "关闭窗口",
  "appHeader.desktopMenu.item.guide": "使用指南",
  "appHeader.desktopMenu.item.keyboardShortcuts": "键盘快捷键",
  "appHeader.desktopMenu.item.openLogDir": "打开日志目录",
  "appHeader.desktopMenu.item.copyDiagnostics": "复制诊断信息",
  /**
   * #34C 文件 → 导出子菜单。收藏夹/知识库两项的名字刻意带上格式后缀（CSV / Markdown），
   * 用户点之前就知道会拿到什么；整库备份仍是设置页那个「备份与恢复」入口（id 未改）。
   */
  "appHeader.desktopMenu.item.export": "导出",
  "appHeader.desktopMenu.item.exportFavorites": "收藏夹（CSV）",
  "appHeader.desktopMenu.item.exportKnowledge": "知识库（Markdown）",
  "appHeader.desktopMenu.item.backupAll": "整库备份…",
  "appHeader.desktopMenu.export.favoritesDone": "已导出收藏夹",
  "appHeader.desktopMenu.export.knowledgeDone": "已导出知识库",
  "appHeader.desktopMenu.export.failed": "导出失败",
  "appHeader.desktopMenu.about.title": "关于简历通",
  "appHeader.desktopMenu.about.version": "版本 {version}",
  "appHeader.desktopMenu.about.github": "GitHub 仓库",
  "appHeader.desktopMenu.about.website": "官网",
  "appHeader.desktopMenu.about.license": "开源许可",
  // #34H：「检查更新」只留在「关于」里（菜单里不再重复一份）。
  "appHeader.desktopMenu.about.checkUpdate": "检查更新",
  /**
   * #34D 复制诊断信息：合成后的文本会原样贴给支持者，所以每一段的标题也从语言包来。
   * 值由诊断模块（desktopDiagnostics.ts）拼；API Key 永远只出现"已配置/未配置"。
   */
  "appHeader.desktopMenu.diagnostics.title": "ResumeForge 诊断信息",
  "appHeader.desktopMenu.diagnostics.version": "版本：{version}",
  "appHeader.desktopMenu.diagnostics.platform": "平台：{platform}",
  "appHeader.desktopMenu.diagnostics.dataDir": "数据目录：{path}",
  "appHeader.desktopMenu.diagnostics.logDir": "日志目录：{path}",
  "appHeader.desktopMenu.diagnostics.model": "模型配置",
  "appHeader.desktopMenu.diagnostics.baseUrl": "接口地址：{url}",
  "appHeader.desktopMenu.diagnostics.apiKeyConfigured": "API Key：已配置（已脱敏）",
  "appHeader.desktopMenu.diagnostics.apiKeyMissing": "API Key：未配置",
  "appHeader.desktopMenu.diagnostics.switches": "开关状态",
  "appHeader.desktopMenu.diagnostics.readFailed": "读取失败",
  "appHeader.desktopMenu.diagnostics.on": "开",
  "appHeader.desktopMenu.diagnostics.off": "关",
  "appHeader.desktopMenu.diagnostics.problems": "最近 {count} 条 WARN/ERROR",
  "appHeader.desktopMenu.diagnostics.problemsEmpty": "最近没有 WARN/ERROR",
  "appHeader.desktopMenu.diagnostics.switch.reminderPopup": "提醒弹窗",
  "appHeader.desktopMenu.diagnostics.switch.webFormRelaxed": "网申放宽模式",
  "appHeader.desktopMenu.diagnostics.switch.assistantRelaxed": "助手放宽模式",
  "appHeader.desktopMenu.diagnostics.switch.theme": "主题",
  "appHeader.desktopMenu.diagnostics.switch.locale": "界面语言",
  "appHeader.desktopMenu.diagnostics.copied": "已复制诊断信息",
  "appHeader.desktopMenu.diagnostics.copyFailed": "复制诊断信息失败",
} as const;

export default appHeader;
