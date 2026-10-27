// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场（`pages/jobs/**`）：筛选工具栏、批量操作条、批量动作的提示，以及
 * 单个岗位加入投递队列的确认链。
 *
 * 表格视图与行操作在 `zh-CN.jobTable.ts`；岗位来源角标的显示名也在那里。
 */
const jobsPage = {
  // ── 批量操作条（BatchToolbar） ──────────────────────────
  "jobsPage.toolbar.selectedCount": "已选 {count} 个岗位",
  "jobsPage.toolbar.selectAllTooltip":
    "按当前筛选，一键选中全部 {count} 个岗位（跨页，不止当前页）",
  "jobsPage.toolbar.selectAllButton": "全选全部岗位（共 {count} 个）",
  "jobsPage.toolbar.exitSelection": "退出选择",
  "jobsPage.toolbar.clearSelection": "清空选择",
  "jobsPage.toolbar.statusPlaceholder": "批量设置状态",
  "jobsPage.toolbar.applyStatus": "应用状态",
  "jobsPage.toolbar.enqueueTooltip":
    "海投路径：直接加入投递队列（未分析/真实缺口不再逐条弹确认）；来源不支持的岗位自动跳过并在结果中说明",
  "jobsPage.toolbar.enqueue": "加入投递队列",
  "jobsPage.toolbar.exportCsv": "导出 CSV",
  "jobsPage.toolbar.exportFileName": "岗位列表-{stamp}.csv",
  "jobsPage.toolbar.exported": "已导出 {count} 个岗位",
  "jobsPage.toolbar.exportFailed": "导出失败",
  "jobsPage.toolbar.delete": "批量删除",

  // ── 筛选工具栏（JobFilterBar） ──────────────────────────
  "jobsPage.filter.searchPlaceholder": "搜索岗位 / 公司 / 城市 / 描述 / 备注",
  "jobsPage.filter.jobTypeAria": "岗位类型筛选",
  "jobsPage.filter.jobTypePlaceholder": "类型",
  "jobsPage.filter.statusAria": "岗位状态筛选",
  "jobsPage.filter.statusPlaceholder": "状态",
  "jobsPage.filter.sourceAria": "来源筛选",
  "jobsPage.filter.sourcePlaceholder": "来源",
  "jobsPage.filter.analyzeMatch": "AI 分析适配度",
  "jobsPage.filter.matchHistory": "分析记录",
  "jobsPage.filter.candidates": "备选岗位",
  "jobsPage.filter.backfill": "补齐详情",
  "jobsPage.filter.importCsv": "导入 CSV",
  "jobsPage.filter.addManual": "手动添加",
  "jobsPage.filter.sortResetHintDefault": "当前已是默认排序：最近导入在前",
  "jobsPage.filter.sortResetHint": "恢复默认排序：最近导入在前",
  "jobsPage.filter.sortReset": "恢复默认排序",

  // 来源筛选的选项标签（`value` 是后端 `source_kind` 的协议值，不翻）
  "jobsPage.filter.sourceCollected": "自动采集",
  "jobsPage.filter.sourceManual": "手动添加",

  // ── 批量动作的提示（useJobBatchActions） ────────────────
  "jobsPage.batch.needSelection": "请先选择岗位",
  "jobsPage.batch.needStatus": "请选择要设置的状态",
  "jobsPage.batch.statusUpdated": "已更新 {count} 个岗位的状态",
  "jobsPage.batch.statusUpdateFailed": "批量更新状态失败",
  "jobsPage.batch.deletePartial": "成功 {deleted} 个，{failed} 个未能删除；已删除的可在回收站恢复",
  "jobsPage.batch.deleted": "已删除 {deleted} 个岗位，可在回收站恢复",
  "jobsPage.batch.deleteFailed": "批量删除失败",
  "jobsPage.batch.enqueueFailed": "批量加入投递队列失败",

  // ── 加入投递队列的确认链（useJobQueue） ─────────────────
  "jobsPage.queue.added": "已加入投递台队列",
  "jobsPage.queue.unsupportedTitle": "这个岗位不能自动投递",
  "jobsPage.queue.unsupportedOk": "知道了",
  "jobsPage.queue.unanalyzedTitle": "该岗位还没做过匹配分析",
  "jobsPage.queue.unanalyzedContent":
    "建议先做「匹配度分析」。也可以直接加入队列，投递前仍会再核对一次。",
  "jobsPage.queue.unanalyzedOk": "仍然加入队列",
  "jobsPage.queue.realGapTitle": "该岗位存在真实缺口，默认不投",
  "jobsPage.queue.realGapContent":
    "匹配分析判定你确实不具备这些要求：{gaps}。确认仍要投递该岗位吗？",
  "jobsPage.queue.gapSeparator": "、",
  "jobsPage.queue.realGapOk": "确认仍然投递",
  "jobsPage.queue.addFailed": "加入投递台失败",

  // ── 详情打开失败（useJobsPageState） ────────────────────
  "jobsPage.detail.loadFailed": "岗位不存在或已被删除",

  // ── 跨页全选（useSelectAllJobs） ────────────────────────
  "jobsPage.selectAll.empty": "当前筛选下没有岗位",
  "jobsPage.selectAll.overLimit":
    "当前筛选下共 {count} 个岗位，超出单次批量上限 {limit} 个；请先用筛选或搜索缩小范围",
  "jobsPage.selectAll.done": "已选中当前筛选下的全部 {count} 个岗位（所有页）",
  "jobsPage.selectAll.failed": "获取岗位列表失败",
} as const;

export default jobsPage;
