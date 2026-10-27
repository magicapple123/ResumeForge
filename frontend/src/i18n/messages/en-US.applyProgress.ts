// SPDX-License-Identifier: Apache-2.0
/**
 * Apply / collect progress panel: run kinds, steps, counters and the result table.
 *
 * Stop reasons and run kinds are backend codes (`user` / `breaker` / `done` / `error`,
 * `apply` / `collect`). The panel keeps two `Record<string, MessageKey>` tables keyed by
 * those codes and resolves them with `t()` at render time: `t()` must never run at module
 * scope, or the labels would freeze in whatever language was active at load.
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
  "applyProgress.kind.apply": "Apply run",
  "applyProgress.kind.collect": "Collect run",
  "applyProgress.stopReason.user": "Stopped by you",
  "applyProgress.stopReason.breaker": "Paused automatically after too many failures in a row",
  "applyProgress.stopReason.done": "Completed",
  "applyProgress.stopReason.error": "An error occurred",
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
