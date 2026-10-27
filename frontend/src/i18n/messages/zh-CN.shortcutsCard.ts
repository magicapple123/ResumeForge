// SPDX-License-Identifier: Apache-2.0
/**
 * 首页快捷入口卡与它的「自定义快捷入口」弹窗：卡片标题、编辑入口、勾选说明，以及弹窗底部按钮。
 *
 * 卡片里的入口名（岗位广场、简历中心…）来自 `components/navigation/navigationConfig.ts`
 * 的 `MENU_ITEMS`，属于导航命名空间，这里不重复一份。
 *
 * 「保存」按钮复用 `common.action.save`，不再新建一条同义 key。
 */
const shortcutsCard = {
  /** 卡片标题，也是首页上这块区域的名字。 */
  "shortcutsCard.card.title": "快捷入口",
  /** 卡片右上角编辑按钮的文字。 */
  "shortcutsCard.action.edit": "编辑",
  /** 同一个按钮的可访问名：读屏要能听出编辑的是哪一块。 */
  "shortcutsCard.action.editAria": "编辑快捷入口",

  "shortcutsCard.modal.title": "自定义快捷入口",
  "shortcutsCard.modal.hint": "勾选要在首页展示的入口（至少保留 1 项）。",

  /** 把勾选恢复成默认 7 项（只改草稿，点「保存」才写入）。 */
  "shortcutsCard.action.restoreDefault": "恢复默认",
} as const;

export default shortcutsCard;
