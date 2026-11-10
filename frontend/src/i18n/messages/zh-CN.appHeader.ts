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
  "appHeader.desktopMenu.item.minimize": "最小化",
  "appHeader.desktopMenu.item.maximize": "最大化",
  "appHeader.desktopMenu.item.restore": "还原",
  "appHeader.desktopMenu.item.closeWindow": "关闭窗口",
  "appHeader.desktopMenu.item.guide": "使用指南",
  "appHeader.desktopMenu.item.keyboardShortcuts": "键盘快捷键",
  "appHeader.desktopMenu.item.openLogDir": "打开日志目录",
  "appHeader.desktopMenu.item.checkUpdate": "检查更新",
  "appHeader.desktopMenu.about.title": "关于简历通",
  "appHeader.desktopMenu.about.version": "版本 {version}",
  "appHeader.desktopMenu.about.github": "GitHub 仓库",
  "appHeader.desktopMenu.about.website": "官网",
  "appHeader.desktopMenu.about.license": "开源许可",
} as const;

export default appHeader;
