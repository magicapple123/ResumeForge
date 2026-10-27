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
} as const;

export default storageStats;
