// SPDX-License-Identifier: Apache-2.0
/**
 * 「本次采集结果」面板（投递页 · 自动采集）：表格、导入按钮、逐条导入反馈、海投入队。
 *
 * ## 协议值不在这里
 *
 * `outcome` 的取值（`imported` / `duplicate` / `trashed` / `invalid` / `missing`）由后端
 * 返回，是**协议值**：`isProblemOutcome()` 与入队过滤都靠它们做判定，一个字都不能翻。
 * 这里只放它们的**显示文案**，在组件里以 `labelKey` 形式登记、使用处 `t()`。
 *
 * ## 为什么两条 `success` 结尾带「，」
 *
 * 成功提示是「一句结论 + 一颗跳转按钮」：结论与按钮之间必须有分隔符，而按钮是
 * ReactNode（i18n 没有富文本插值），拆成「前半句」+「，」再拼按钮会把标点留在代码里。
 * 因此把句尾的顿号并进这个 key，按钮另起一条 `…Action`。英文同理保留逗号+空格。
 *
 * ## `{summary}` 是一条仍然中文的聚合账目
 *
 * 它来自 `components/apply/queue/bulkEnqueue.ts::bulkEnqueueSummary()`（尚未迁移）。
 * 这里当参数接收，等那个文件迁移时不改本文件。
 */
const collectResult = {
  "collectResult.title": "本次采集结果",
  "collectResult.hint": "勾选要收进岗位广场的岗位，没勾的会留在备选岗位里，之后还能再来挑。",
  "collectResult.empty": "这次采集还没有待导入的岗位（可能都已导入，或一条都没采到）",

  "collectResult.column.title": "岗位",
  "collectResult.column.location": "城市",
  "collectResult.column.salary": "薪资",
  "collectResult.column.source": "原站",
  "collectResult.action.openSource": "查看",

  "collectResult.row.unknownTitle": "（未识别到岗位名）",
  "collectResult.row.unknownCompany": "（未识别到公司）",

  /** 逐条反馈里每种 outcome 的解释。键名是协议值（见文件头）。 */
  "collectResult.outcome.duplicate": "岗位广场里已经有这个岗位（已关联到已有那条，没有重复创建）",
  "collectResult.outcome.trashed":
    "岗位广场的「回收站」里已经有同名岗位——先去回收站恢复它，或彻底删除后再导入",
  "collectResult.outcome.invalid": "这条没有岗位名，成为不了一个正式岗位",
  "collectResult.outcome.missing": "这条候选已经不存在了（可能在别处被删掉）",

  /** 结算条标题。`import.noneAdded` 引用了这句话，两者措辞必须一致。 */
  "collectResult.problem.title": "有 {count} 个岗位没有新建（其余已处理）",

  "collectResult.import.label": "导入选中的岗位",
  "collectResult.import.labelWithCount": "导入选中的 {count} 个岗位",
  "collectResult.import.success": "已导入 {count} 个岗位到岗位广场，",
  "collectResult.import.successAction": "去岗位广场查看",
  "collectResult.import.noneAdded": "没有新增岗位，原因见「有 {count} 个岗位没有新建」提示",
  "collectResult.import.failed": "导入失败",

  "collectResult.queue.tooltip":
    "海投模式：先导入岗位广场，再直接加入投递队列（未分析的岗位会跳过确认直接入队，投递前仍会核对准入）",
  "collectResult.queue.label": "导入并加入投递队列",
  "collectResult.queue.aria": "导入选中的 {count} 个岗位并加入投递队列",
  "collectResult.queue.nothingToQueue": "没有可加入投递队列的岗位（选中项没有成功导入岗位广场）",
  "collectResult.queue.success": "已导入 {count} 个岗位，{summary}，",
  "collectResult.queue.successAction": "去投递队列查看",
  "collectResult.queue.failed": "导入并加入投递队列失败",

  "collectResult.action.selectAll": "全选",
  "collectResult.action.clearSelection": "清空选择",
  "collectResult.footnote": "导入后到「投递队列」把想要的岗位排进去，再点开始投递。",
} as const;

export default collectResult;
