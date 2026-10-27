// SPDX-License-Identifier: Apache-2.0
/**
 * 投递/采集进度面板：批次类型、步骤、计数与结果表。
 *
 * 停止原因与批次类型的显示名（用户停止 / 连续失败过多 / 投递批次 …）是
 * 模块级常量的 label，需先改成 labelKey，留待下一批。
 */
const applyProgress = {
  "applyProgress.column.job": "Job",
  "applyProgress.column.status": "Status",
  "applyProgress.column.failureKind": "Failure type",
  "applyProgress.column.attempt": "Attempts",
  "applyProgress.deletedJob": "(Job deleted)",
  "applyProgress.field.currentStep": "Current step",
  "applyProgress.field.resume": "Resume",
  "applyProgress.defaultResume": "Resolved by default rules",
  "applyProgress.field.greeting": "Greeting",
  "applyProgress.defaultGreeting": "(default greeting used)",
  "applyProgress.field.skipReason": "Skip reason",
  "applyProgress.field.diagnosis": "Diagnostics",
  "applyProgress.field.startedAt": "Started",
  "applyProgress.field.finishedAt": "Finished",
  "applyProgress.kindFallback": "Run",
  "applyProgress.progress": "Current step: {step}",
  "applyProgress.action.pause": "Pause",
  "applyProgress.action.resume": "Resume",
  "applyProgress.action.stop": "Stop",
  "applyProgress.count.processed": "Processed {done} / {total}",
  "applyProgress.count.succeeded": "Succeeded {count}",
  "applyProgress.count.failed": "Failed {count}",
  "applyProgress.count.skipped": "Skipped {count}",
  "applyProgress.action.track": "Follow up in job tracker",
  "applyProgress.empty.collect":
    "Collect runs do not list Jobs one by one; see the Succeeded count for how many were added.",
  "applyProgress.empty.apply": "This run has no Job rows to show.",
} as const;

export default applyProgress;
