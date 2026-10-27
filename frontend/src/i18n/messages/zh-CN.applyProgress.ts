// SPDX-License-Identifier: Apache-2.0
/**
 * 投递/采集进度面板：批次类型、步骤、计数与结果表。
 *
 * 停止原因与批次类型的显示名（用户停止 / 连续失败过多 / 投递批次 …）是
 * 模块级常量的 label，需先改成 labelKey，留待下一批。
 */
const applyProgress = {
  "applyProgress.column.job": "岗位",
  "applyProgress.column.status": "状态",
  "applyProgress.column.failureKind": "失败分类",
  "applyProgress.column.attempt": "尝试",
  "applyProgress.deletedJob": "（岗位已删除）",
  "applyProgress.field.currentStep": "当前步骤",
  "applyProgress.field.resume": "使用简历",
  "applyProgress.defaultResume": "按默认规则解析",
  "applyProgress.field.greeting": "招呼语",
  "applyProgress.defaultGreeting": "（使用默认招呼语）",
  "applyProgress.field.skipReason": "跳过原因",
  "applyProgress.field.diagnosis": "诊断信息",
  "applyProgress.field.startedAt": "开始时间",
  "applyProgress.field.finishedAt": "结束时间",
  "applyProgress.kindFallback": "执行批次",
  "applyProgress.progress": "当前步骤：{step}",
  "applyProgress.action.pause": "暂停",
  "applyProgress.action.resume": "继续",
  "applyProgress.action.stop": "停止",
  "applyProgress.count.processed": "已处理 {done} / {total}",
  "applyProgress.count.succeeded": "成功 {count}",
  "applyProgress.count.failed": "失败 {count}",
  "applyProgress.count.skipped": "已跳过 {count}",
  "applyProgress.action.track": "去求职进度跟进",
  "applyProgress.empty.collect": "采集批次不逐条列出岗位，新增数量见「成功」计数。",
  "applyProgress.empty.apply": "本批次没有可展示的岗位条目。",
} as const;

export default applyProgress;
