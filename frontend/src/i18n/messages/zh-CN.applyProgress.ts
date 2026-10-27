// SPDX-License-Identifier: Apache-2.0
/**
 * 投递/采集进度面板：批次类型、步骤、计数与结果表。
 *
 * 停止原因与批次类型的取值是**后端码**（`user` / `breaker` / `done` / `error`、
 * `apply` / `collect`），面板里存的是两张 `Record<string, MessageKey>`，键仍是码，
 * 取值处 `t()`——模块作用域不能调 `t()`，否则切语言不会重算。
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
  "applyProgress.kind.apply": "投递批次",
  "applyProgress.kind.collect": "采集批次",
  "applyProgress.stopReason.user": "用户停止",
  "applyProgress.stopReason.breaker": "连续失败过多，已自动暂停",
  "applyProgress.stopReason.done": "已完成",
  "applyProgress.stopReason.error": "发生错误",
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
