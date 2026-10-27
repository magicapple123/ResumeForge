// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场「批量适配度分析」面板：设置 → 进行中（后台任务进度）→ 结果，与历史回看。
 *
 * 历史列表的摘要有两个 key（普通版与带最高参考分版），而不是「主句 + 逗号开头的后缀」：
 * 后缀片段在英文里拼不出通顺句子，i18n 也没有「可选片段」这种插值。
 */
const jobMatchBatch = {
  "jobMatchBatch.title": "岗位批量适配度分析",
  "jobMatchBatch.action.start": "开始分析",
  "jobMatchBatch.action.restart": "重新分析这批",
  "jobMatchBatch.action.viewResult": "查看结果",
  "jobMatchBatch.action.cancel": "取消本次分析",
  "jobMatchBatch.action.background": "转入后台，先去忙别的",
  "jobMatchBatch.tab.running": "进行中",
  "jobMatchBatch.tab.result": "本次结果",
  "jobMatchBatch.tab.setup": "分析设置",
  "jobMatchBatch.tab.history": "历史记录",
  "jobMatchBatch.running.title": "正在后台分析，关闭这个窗口也不会中断",
  "jobMatchBatch.running.body":
    "分析在服务端逐个岗位进行；切到其他页面任务会继续，完成时会弹出通知。",
  "jobMatchBatch.running.progress": "已完成 {done} / {total} 个岗位",
  "jobMatchBatch.running.failed": "（失败 {count}）",
  "jobMatchBatch.running.current": "正在分析：{title}",
  "jobMatchBatch.running.waiting": "等待后台任务启动…",
  "jobMatchBatch.setup.title": "将为 {count} 个勾选的岗位逐一分析适配度",
  "jobMatchBatch.setup.body":
    "分析在后台逐个岗位进行：可以随时取消，也可以关掉窗口先去忙别的，完成时会弹出通知；结论不带百分比，参考分仅作展示排序用。",
  "jobMatchBatch.setup.force": "重新分析已有结论的岗位（默认跳过已有适配度结论的岗位）",
  "jobMatchBatch.setup.selected": "本次选择：{count} 个岗位",
  "jobMatchBatch.history.empty": "还没有批量分析记录",
  "jobMatchBatch.history.batchTitle": "第 {id} 批 · {time}",
  "jobMatchBatch.history.summary": "共 {requested} 个岗位，完成 {completed} 个，失败 {failed} 个",
  "jobMatchBatch.history.summaryWithScore":
    "共 {requested} 个岗位，完成 {completed} 个，失败 {failed} 个，最高参考分 {score}",
  "jobMatchBatch.detail.title": "第 {id} 批分析结果",
  "jobMatchBatch.detail.loading": "读取分析结果…",
  "jobMatchBatch.task.title": "岗位适配度分析（{count} 个岗位）",
  "jobMatchBatch.toast.needJobs": "请先选择岗位",
  "jobMatchBatch.toast.cancelled": "已取消本次分析；取消前完成的结果仍已保存",
  "jobMatchBatch.error.loadHistoryFailed": "读取匹配记录失败",
  "jobMatchBatch.error.loadResultFailed": "读取分析结果失败",
  "jobMatchBatch.error.createFailed": "创建分析任务失败",
  "jobMatchBatch.error.cancelFailed": "取消失败",
} as const;

export default jobMatchBatch;
