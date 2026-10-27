// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「数据」页签里数据集管理的**操作反馈**文案（`useSettingsDatasets`）。
 *
 * ## 覆盖什么
 *
 * 导出/导入的整句回执、未纳入备份的范围说明、全局模型配置与字体的恢复条数、切换/重命名/
 * 删除/新建的 Toast，以及导入遇到附件问题时的二次确认。数据集卡片自身的静态文案在
 * `zh-CN.datasets.ts`；这里只收**事件发生时才生成**的句子。
 *
 * ## 为什么是「整句成 key」
 *
 * 这些句子由 `parts` 数组拼成（「已导入数据集…」+「并随包恢复了另外 N 份…」+ …），
 * 中文用全角逗号、英文用半角逗号加空格连接，句末再接「；当前数据未受影响」。把分隔符
 * 留在代码里（`parts.join("，")`）等于在代码里写死一种语言的标点，英文界面就会出现
 * 全角与半角混排——所以 `partsSeparator` / `problemSeparator` / `namesSeparator`
 * 也是 key（与 `bulkEnqueue.summary.separator` 同一处理）。份数、名字、体积走
 * `{count}` / `{name}` / `{size}` 参数，不把数字拼在字符串外。
 *
 * ## 这里的 key 全是事件期求值
 *
 * hook 里没有渲染期文案：`t()` 只出现在 `message.*` / `modal.confirm` 的实参位置，
 * 读的是**调用那一刻**的 locale。渲染这些提示的 `SettingsPage` 与 `DatasetsCard`
 * 已各自订阅 `useLocale()`，所以不需要在 hook 里再订阅一次（`.ts` 也不该调 Hook）。
 *
 * ## 留在源码里的那一条
 *
 * `text.includes("附件未通过校验")` 是**匹配后端返回的错误文案**，属于协议耦合：
 * 翻了就永远匹配不上，所以原样留在 `useSettingsDatasets.ts` 并带 `// i18n-ok:`。
 */
const settingsDatasets = {
  /** 读取数据集列表失败的兜底（后端给了 message 就用后端的）。 */
  "settingsDatasets.load.failed": "加载数据集失败",

  /** 分句之间的分隔符（见文件头：标点也是文案）。 */
  "settingsDatasets.partsSeparator": "，",
  /** 逐条问题之间的分隔符。 */
  "settingsDatasets.problemSeparator": "；",

  /**
   * 未纳入备份的数据目录项（R17/H3）：只说**范围**，不说"备份失败"。
   *
   * 下面三条是全句的零件——后端扫描到上限时数量只是下限，必须说成「至少 N 项」。
   */
  "settingsDatasets.uncovered.atLeast": "至少 {count} 项",
  /** 正常情形的数量。 */
  "settingsDatasets.uncovered.count": "{count} 项",
  /** 体积括注；为 0 时整段不出现。 */
  "settingsDatasets.uncovered.size": "（{size}）",
  /** 整句：这批东西在数据目录里、但不在这个包里，详情去包内清单看。 */
  "settingsDatasets.uncovered.summary":
    "另有 {amount}{size}未纳入备份：它们在数据目录里，但不在这个包里；详见包内 manifest.json 的 uncovered 段",

  /** 单份导出成功：讲清去哪了。 */
  "settingsDatasets.export.datasetDone": "已导出「{name}」到浏览器的下载目录",
  /** 全部导出成功：带份数。 */
  "settingsDatasets.export.allDone": "已把全部 {count} 份数据集导出到浏览器的下载目录",
  /** 单份导出失败的兜底。 */
  "settingsDatasets.export.failed": "导出数据集失败",
  /** 全部导出失败的兜底。 */
  "settingsDatasets.export.allFailed": "导出全部数据集失败",
  /** 被引用的附件在磁盘上找不到（这次导出真的丢了文件）。 */
  "settingsDatasets.export.missingAttachments":
    "有 {count} 个被引用的附件在磁盘上找不到，备份里不包含它们",
  /** 附件内容与数据库登记不符（包里装的是当前磁盘上的字节）。 */
  "settingsDatasets.export.mismatchedAttachments":
    "{count} 个附件内容与数据库登记不符，包里装的是当前磁盘上的字节",
  /** 成功回执 + 这次导出不完整的原因清单；`summary` 是上面几条成功文案。 */
  "settingsDatasets.export.incomplete": "{summary}，但这份备份「不完整」：{problems}",
  /** 自导入起就缺失的附件：不影响本次导出，但要在清单里注明。 */
  "settingsDatasets.export.missingAtImport":
    "另有 {count} 个附件在该数据集导入时就已缺失，已在包内清单注明",

  /** 导入成功的主句。 */
  "settingsDatasets.import.done": "已导入数据集「{name}」",
  /** 整包里随行恢复的其余数据集份数。 */
  "settingsDatasets.import.extraDatasets": "并随包恢复了另外 {count} 份数据集",
  /** 逐份点名（最多 3 个），挂在份数后面。 */
  "settingsDatasets.import.extraNames": "（{names}）",
  /** 逐份点名被截断时补一个「等」。 */
  "settingsDatasets.import.extraNamesMore": "（{names} 等）",
  /** 点名之间的分隔符。 */
  "settingsDatasets.import.namesSeparator": "、",
  /** 包里带着密钥时如实告知（换机器解不开仍需重填）。 */
  "settingsDatasets.import.apiKeyRestored": "备份中的大模型 API Key 已一并恢复",
  /** 全局模型配置整段导入失败，附后端原因。 */
  "settingsDatasets.import.globalFailed": "全局模型配置未能导入（{error}）",
  /** 全局模型配置恢复条数。 */
  "settingsDatasets.import.globalRestored": "全局模型配置已恢复 {count} 条",
  /** 同名记录保留本机版本后跳过的条数，挂在恢复条数后面。 */
  "settingsDatasets.import.globalSkipped": "（跳过 {count} 条同名）",
  /** 一条都没恢复、全部与本地同名。 */
  "settingsDatasets.import.globalKeptLocal": "全局模型配置 {count} 条与本地同名，已保留本地版本",
  /** 自定义字体恢复份数。 */
  "settingsDatasets.import.fontsRestored": "恢复了 {count} 个自定义字体",
  /** 同名字体保留本机版本的份数。 */
  "settingsDatasets.import.fontsSkipped": "{count} 个同名字体保留本机版本",
  /** 导入成功且没有问题时的整句；`parts` 是上面各分句的连接结果。 */
  "settingsDatasets.import.summaryOk": "{parts}；当前数据未受影响",
  /** 带着附件问题导入时的整句：先回执，再说清这份备份不完整（问题清单最多 3 条）。 */
  "settingsDatasets.import.summaryIncomplete":
    "{parts}；当前数据未受影响，但这份备份「不完整」：{problems}",
  /** 有附件问题但后端没给出具体条目时的兜底说明。 */
  "settingsDatasets.import.fallbackProblem": "附件存在缺失或校验不一致",
  /** 问题清单被截断时的总条数括注。 */
  "settingsDatasets.import.moreProblems": "（共 {count} 条）",
  /** 字体没能完全恢复（只影响 PDF 字形，不算备份不完整）。 */
  "settingsDatasets.import.fontsIncomplete": "字体未完全恢复：{problems}",
  /** 导入失败的兜底。 */
  "settingsDatasets.import.failed": "导入备份失败",
  /** 附件问题二次确认的标题。 */
  "settingsDatasets.import.assetProblemTitle": "备份包的附件有问题",
  /** 附件问题二次确认的正文：先说清代价，再给「跳过附件」这条出路。 */
  "settingsDatasets.import.assetProblemContent":
    "{error}\n\n可以选择跳过有问题的附件，只导入数据库内容（这些附件在你本机的原文件不会被改动）。",
  /** 二次确认的主按钮：写具体动作，不用「确定」。 */
  "settingsDatasets.import.skipAssets": "跳过附件继续导入",

  /** 切换成功：讲清接下来会发生什么（整页重载）。 */
  "settingsDatasets.switch.done": "已切换到「{name}」，正在刷新页面",
  /** 切换失败的兜底（原始异常另有「原因 + 建议 + 编号」指引）。 */
  "settingsDatasets.switch.failed": "切换数据集失败",
  /** 重命名成功。 */
  "settingsDatasets.rename.done": "已重命名",
  /** 重命名失败的兜底。 */
  "settingsDatasets.rename.failed": "重命名失败",
  /** 删除成功：讲清去哪找回（删除是移出列表，文件仍在磁盘上）。 */
  "settingsDatasets.delete.done": "已删除「{name}」，可在 data/datasets/.trash/ 找回",
  /** 删除失败的兜底。 */
  "settingsDatasets.delete.failed": "删除数据集失败",
  /**
   * 删除数据集的后果段（唯一出口）。
   *
   * 刻意**不**复用 `TRASH_RECOVERY_NOTE`：数据集删除只是把文件移出列表，它不进「回收站」
   * 页，界面上也就没有恢复入口——写"可在「回收站」里恢复"是承诺一件应用做不到的事（R2）。
   */
  "settingsDatasets.delete.note": "数据集会移出列表，界面上没有恢复入口；删除前请先「导出」备份。",
  /** 新建时名称为空。 */
  "settingsDatasets.create.nameRequired": "请填写数据集名称",
  /** 新建成功：讲清它在哪、怎么过去。 */
  "settingsDatasets.create.done": "已新建数据集「{name}」，可在列表里切换到它",
  /** 新建失败的兜底。 */
  "settingsDatasets.create.failed": "新建数据集失败",
} as const;

export default settingsDatasets;
