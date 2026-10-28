// SPDX-License-Identifier: Apache-2.0
/**
 * 存储占用卡（`StorageStatsCard`）：数据目录各分项的磁盘占用与文件数，以及按类别清理。
 *
 * ## 「最近 3 份备份不会出现在清单里」是**模块级常量**
 *
 * 那条固定提示语跟着后端保留策略走，不能在模块作用域里 `t()`（会把语言固定在模块
 * 求值那一刻，交接单 §8.1），所以常量存的是 **key**（`RECENT_BACKUPS_HINT_KEY`），
 * 用它的两处都 `t(...)`。
 *
 * ## 它出现在两句话中间，但不做「前半句 + 插值 + 后半句」
 *
 * 清理结果的告知与清单上方的说明都把它当 `{hint}` 参数塞进**整句**——中文原文里
 * 那个 `；` / `（…）` 是句子的一部分，切成碎片在英文里语序一定不通。
 *
 * ## 清理确认里的条件片段单独成 key
 *
 * 「另有 N 个文件被占用」只在 `failed > 0` 时渲染，它的句式与前面两句无关，所以是
 * 独立的一条 key，不塞进大模板。
 */
const storageStats = {
  "storageStats.title": "存储占用",
  /** 卡片右上角刷新按钮的无障碍名。 */
  "storageStats.refresh.aria": "刷新存储占用",
  /** 读取统计失败的兜底文案（后端给了 message 就用后端的）。 */
  "storageStats.loadFailed": "读取存储占用失败",
  /** 数据目录总计说明：`{size}` 是体积、`{count}` 是文件数。 */
  "storageStats.summary":
    "数据目录共占用 {size}（{count} 个文件）。这里只显示体积，不会读取或改动任何文件内容；占用大的目录（如投递浏览器的用户目录）属于正常现象。",
  /** 一个文件都没有时的空态。 */
  "storageStats.empty": "还没有产生本地文件",

  /** 固定提示语：保留策略在后端，文案跟着它走（改了常量也要改这句）。 */
  "storageStats.recentBackupsHint": "最近 3 份备份不会出现在清单里",

  /** 卡片右上角的入口按钮。 */
  "storageStats.cleanup.action": "清理旧文件",
  /** 清理弹窗的标题（与入口按钮同一句话，但两处独立，改一处不影响另一处）。 */
  "storageStats.cleanup.title": "清理旧文件",
  /** 没有可清理项时的一句反馈；`{days}` 是保留天数。 */
  "storageStats.cleanup.nothing": "没有超过 {days} 天的旧备份或日志，暂时不用清理",
  /** 预览/重新预览失败的兜底文案。 */
  "storageStats.cleanup.planFailed": "读取清理清单失败",

  /** 清单上方的提醒：`{days}` 保留期、`{size}` 选中类别合计体积、`{count}` 文件数。 */
  "storageStats.cleanup.plan.title":
    "以下文件超过 {days} 天没有变动，选中类别共 {size}（{count} 个）",
  /** 清单上方的去向说明：移到回收目录（按时间分文件夹），不彻底删除。 */
  "storageStats.cleanup.plan.description":
    "清理会把它们移到本地数据目录下的回收目录（按时间分文件夹），不会彻底删除；确认无误后可自行在文件管理器里删除那个目录。",
  /** 清单上方的保留提示：`{hint}` 是固定提示语，`{count}` 是本次保留份数。 */
  "storageStats.cleanup.plan.kept": "{hint}（本次已保留 {count} 份）。",
  /** 按类别分组的一行：`{files}` 文件数、`{size}` 体积。 */
  "storageStats.category.files": "{files} 个文件 · {size}",
  /** 候选清单被截断时的说明；`{count}` 是未列出的文件数。 */
  "storageStats.cleanup.more": "还有 {count} 个文件未列出，确认后一并移走。",

  /** 保留期选择：前缀 + 天数档位 + 后缀拼成一句。 */
  "storageStats.cleanup.days.prefix": "清理超过",
  "storageStats.cleanup.days.option": "{count} 天",
  "storageStats.cleanup.days.suffix": "没有变动的文件",
  /** 逐文件勾选的摘要：`{count}` 已选文件数、`{size}` 合计体积。 */
  "storageStats.cleanup.selected.summary": "已选 {count} 个 · {size}",
  /** 逐文件清单的全选 / 清空。 */
  "storageStats.cleanup.select.all": "全选",
  "storageStats.cleanup.select.none": "清空",
  /** 清理结果弹窗的标题；`{count}` 是移走的文件数。 */
  "storageStats.cleanup.done.title": "已移走 {count} 个文件",
  /** 结果第一句：`{size}` 是释放的体积。 */
  "storageStats.cleanup.done.freed": "释放 {size}，已移到本地数据目录下的回收目录，不会彻底删除。",
  /** 结果第二句：`{hint}` 固定提示语，`{count}` 本次保留份数。 */
  "storageStats.cleanup.done.kept": "{hint}；本次保留 {count} 份。",
  /** 结果第三句（只在有文件被占用时出现）。 */
  "storageStats.cleanup.done.busy": "另有 {count} 个文件被占用，未能移动。",
  /** 执行清理失败的兜底文案。 */
  "storageStats.cleanup.failed": "清理失败",

  /** 确认按钮（有清单时带上文件数）。 */
  "storageStats.cleanup.okCount": "移走 {count} 个文件",
  /** 确认按钮（清单还没回来时的兜底）。 */
  "storageStats.cleanup.ok": "移走",

  /**
   * 各目录分项的展示名：后端 `_ITEM_SPECS[].label` 的稳定 `key` → 文案。
   *
   * 中文逐字对齐后端原文（翻译后中文界面渲染结果不变）；后端新增分项映射不到时
   * 调用方回退后端原文，不丢信息。
   */
  "storageStats.item.database": "数据库（含 WAL 边车）",
  "storageStats.item.datasets": "数据集（含回收站）",
  "storageStats.item.backups": "手动备份",
  "storageStats.item.auto_backups": "自动备份快照",
  "storageStats.item.user_files": "附件磁盘副本",
  "storageStats.item.exports": "导出备份包",
  "storageStats.item.captures": "站点采集样例",
  "storageStats.item.share_packages": "分享页面包",
  "storageStats.item.referral_images": "内推备注图片",
  "storageStats.item.logs": "日志",
  "storageStats.item.browser_profile": "投递浏览器用户目录",
  "storageStats.item.webform_browser_profile": "网申浏览器用户目录",
  "storageStats.item.restore": "导入暂存",
  "storageStats.item.pre_update": "升级前快照",
  "storageStats.item.uncategorized": "未分类（其他文件）",

  /** 清理弹窗里的类别名：后端 `cleanup.CATEGORIES[].key` → 文案（中文与后端逐字一致）。 */
  "storageStats.cleanupCategory.backups": "手动与迁移备份",
  "storageStats.cleanupCategory.backup-trash": "备份回收目录",
  "storageStats.cleanupCategory.auto-backups": "自动备份",
  "storageStats.cleanupCategory.logs": "运行日志",
} as const;

export default storageStats;
