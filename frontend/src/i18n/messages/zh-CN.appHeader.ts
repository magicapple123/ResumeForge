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
} as const;

export default appHeader;
