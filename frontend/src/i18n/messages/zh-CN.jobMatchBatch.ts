// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场批量分析面板：设置 → 进行中（后台任务进度）→ 结果，与历史回看。
 *
 * 两种模式共用这套文案：`match` = 逐岗位给匹配结论（从批量操作「匹配度分析」进入）；
 * `compare` = 逐岗结论之后再横向排序并解释原因（从筛选条「AI 对比选岗」进入）。
 * 两种模式各有一份标题/设置文案，避免把"逐个分析"与"放在一起比较"说成同一件事。
 *
 * 历史列表的摘要有两个 key（普通版与带最高参考分版），而不是「主句 + 逗号开头的后缀」：
 * 后缀片段在英文里拼不出通顺句子，i18n 也没有「可选片段」这种插值。
 */
const jobMatchBatch = {
  "jobMatchBatch.title": "岗位匹配度分析",
  "jobMatchBatch.title.compare": "岗位横向对比",
  "jobMatchBatch.action.start": "开始分析",
  "jobMatchBatch.action.start.compare": "开始对比",
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
  "jobMatchBatch.setup.title": "将为 {count} 个勾选的岗位逐一分析匹配度",
  "jobMatchBatch.setup.body":
    "分析在后台逐个岗位进行：可以随时取消，也可以关掉窗口先去忙别的，完成时会弹出通知；结论不带百分比，参考分仅作展示排序用。",
  "jobMatchBatch.setup.title.compare": "将横向对比 {count} 个勾选的岗位",
  "jobMatchBatch.setup.body.compare":
    "先逐个岗位核对匹配情况，再把这些岗位放在一起排出适合程度并说明原因，让你看清“它为什么更适合我”。排序来自相对比较、不出现百分比；参考分仍只作展示。分析在后台进行，可以取消，也可以关掉窗口先去忙别的。",
  "jobMatchBatch.setup.force": "重新分析已有结论的岗位（默认跳过已有匹配结论的岗位）",
  "jobMatchBatch.setup.selected": "本次选择：{count} 个岗位",
  "jobMatchBatch.history.empty": "还没有批量分析记录",
  "jobMatchBatch.history.batchTitle": "第 {id} 批 · {time}",
  "jobMatchBatch.history.summary": "共 {requested} 个岗位，完成 {completed} 个，失败 {failed} 个",
  "jobMatchBatch.history.summaryWithScore":
    "共 {requested} 个岗位，完成 {completed} 个，失败 {failed} 个，最高参考分 {score}",
  "jobMatchBatch.history.mode.compare": "横向对比",
  "jobMatchBatch.history.mode.match": "匹配度分析",
  "jobMatchBatch.detail.title": "第 {id} 批分析结果",
  "jobMatchBatch.detail.loading": "读取分析结果…",
  "jobMatchBatch.task.title": "岗位匹配度分析（{count} 个岗位）",
  "jobMatchBatch.task.title.compare": "岗位横向对比（{count} 个岗位）",
  "jobMatchBatch.toast.needJobs": "请先选择岗位",
  "jobMatchBatch.toast.cancelled": "已取消本次分析；取消前完成的结果仍已保存",
  "jobMatchBatch.error.loadHistoryFailed": "读取匹配记录失败",
  "jobMatchBatch.error.loadResultFailed": "读取分析结果失败",
  "jobMatchBatch.error.createFailed": "创建分析任务失败",
  "jobMatchBatch.error.cancelFailed": "取消失败",
  "jobMatchBatch.comparison.rank": "第 {rank} 名",
  "jobMatchBatch.comparison.verdict.best": "最合适",
  "jobMatchBatch.comparison.verdict.good": "较合适",
  "jobMatchBatch.comparison.verdict.fair": "一般",
  "jobMatchBatch.comparison.verdict.weak": "偏弱",
  "jobMatchBatch.comparison.concerns": "需要注意：{concerns}",
  "jobMatchBatch.comparison.separator": "、",
  "jobMatchBatch.comparison.disclaimer":
    "排序来自本次逐岗位结论的相对比较，不出现百分比；参考分仍是本地规则估算，只作展示，不参与投递准入。",
} as const;

export default jobMatchBatch;
