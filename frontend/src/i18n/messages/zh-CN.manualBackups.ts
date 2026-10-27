// SPDX-License-Identifier: Apache-2.0
/**
 * 手动备份卡（`ManualBackupsCard`）：backups/ 目录里的快照清单与逐份可恢复移除。
 *
 * ## 两处「参数化」的注意点
 *
 * 逐份确认弹窗的正文原本是两段 JSX，中间插着 `formatSize()` 与 `formatDateTime()` 两个
 * 表达式；批量确认的正文里插着份数。这里的做法是**整句成 key、表达式走参数**
 * （`{size}` / `{time}` / `{count}`），而不是「前半句 + 插值 + 后半句」——后者在英文里
 * 语序一定不通。
 *
 * ## `backups/` 是技术常量，不进 `{placeholder}`
 *
 * 目录名在两种语言里写法相同，属于交接单 §3 的技术常量，原样留在句子里。
 *
 * ## `label` 全是组件体内求值
 *
 * 右键菜单项与每行「···」菜单都在组件体内（`contextItems`、`itemRender`）构造，所以
 * 可以直接 `t()`；模块作用域里调 `t()` 才会把语言固定住（§8.1）。
 */
const manualBackups = {
  "manualBackups.title": "手动备份",
  /** 卡片右上角刷新按钮的无障碍名。 */
  "manualBackups.refresh.aria": "刷新手动备份列表",
  /** 读取列表失败的兜底文案（后端给了 message 就用后端的）。 */
  "manualBackups.loadFailed": "读取手动备份失败",

  /** 单份移除成功的 Toast：讲清去了哪、还能不能找回。 */
  "manualBackups.trashed": "已移到本地数据目录下的回收目录，可在文件管理器里彻底删除或找回",

  /** 逐份确认弹窗的标题；`{name}` 是快照文件名。 */
  "manualBackups.confirm.title": "移除备份「{name}」？",
  /** 逐份确认弹窗的第一段：体积与快照时间，一句话两个参数。 */
  "manualBackups.confirm.size": "这份备份约占 {size}，快照时间：{time}。",
  /** 逐份确认弹窗的第二段：移到哪、能不能找回、有没有自动清理。 */
  "manualBackups.confirm.body":
    "移除后会放到本地数据目录下的回收目录里，随时可以在文件管理器里找回来；系统不会自动清理。",
  /** 确认按钮：写具体动作（移到回收目录），不用「确定」。 */
  "manualBackups.action.trash": "移到回收目录",
  /** 移除失败的兜底文案。 */
  "manualBackups.removeFailed": "移除失败",

  /** 批量确认弹窗的标题。 */
  "manualBackups.batch.confirm.title": "移除选中的备份？",
  /** 批量确认弹窗的正文；`{count}` 是选中份数。 */
  "manualBackups.batch.confirm.body":
    "这 {count} 份备份移除后会放到本地数据目录下的回收目录里，随时可以在文件管理器里找回来；系统不会自动清理。",
  /** 部分失败：成功 `{done}` 份、失败 `{failed}` 份。 */
  "manualBackups.batch.partial": "已移除 {done} 份，{failed} 份移除失败",
  /** 全部成功；`{count}` 是份数。 */
  "manualBackups.batch.done": "已把 {count} 份备份移到本地数据目录下的回收目录",

  /** 卡片顶部的说明（与批量操作同一行）。 */
  "manualBackups.intro":
    "这里是迁移或手工备份留在 backups/ 目录里的数据库快照。不会自动清理；确认后移除到本地数据目录下的回收目录，需要时还能找回。",
  /** 批量模式下的主按钮。 */
  "manualBackups.action.removeSelected": "移除所选",
  /** 一条都没有时的空态：顺带说清快照是怎么来的。 */
  "manualBackups.empty": "暂无手动备份快照。数据库升级前会自动在这里留一份快照。",

  /** 每行「···」菜单里的移除项。 */
  "manualBackups.action.remove": "移除",
  /** 「···」按钮的无障碍名；`{name}` 是快照文件名，读屏用户靠它区分行。 */
  "manualBackups.more.aria": "备份 {name} 的更多操作",
  /** 行首勾选框的无障碍名。 */
  "manualBackups.select.aria": "选择备份 {name}",

  /** 列表底部的告知：回收目录里还留着几份已移除的快照；`{count}` 是份数。 */
  "manualBackups.trashNote":
    "本地数据目录下的回收目录里还有 {count} 份已移除的快照，确认不要了可以在文件管理器里删除。",
} as const;

export default manualBackups;
