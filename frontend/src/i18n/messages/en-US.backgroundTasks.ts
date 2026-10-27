// SPDX-License-Identifier: Apache-2.0
/**
 * Everything the background-task surfaces say: the header "Background tasks" indicator and
 * the standing task bar (progress, cancel/remove), the risk-scan / job-suggestion /
 * job-analysis background notifications, and the unified completion notices for generation
 * and for apply / collect batches.
 */
const backgroundTasks = {
  "backgroundTasks.label": "Background tasks",
  "backgroundTasks.aria.viewTasks": "View background tasks",
  "backgroundTasks.popover.title": "Tasks in progress",
  "backgroundTasks.tooltip.running": "{count} tasks in progress",
  "backgroundTasks.status.preparing": "Preparing...",
  "backgroundTasks.status.unknown": "Task status unknown",
  "backgroundTasks.progress.received": "Received {count} characters",
  "backgroundTasks.progress.processed": "Processed {done}/{total} jobs",
  "backgroundTasks.progress.currentJob": "Current: {title}",
  "backgroundTasks.action.cancel": "Cancel",
  "backgroundTasks.action.remove": "Remove",
  "backgroundTasks.jobAnalysis.label": "Job analysis",
  "backgroundTasks.jobAnalysis.running": "Generating the job analysis...",
  "backgroundTasks.toast.cancelled": 'Cancelled "{name}"',
  "backgroundTasks.toast.cancelRequested": 'Requested cancellation of "{name}"',
  "backgroundTasks.toast.dismissed": 'Removed "{name}"',
  "backgroundTasks.toast.cancelFailed": "Could not cancel - try again later",
  "backgroundTasks.toast.jobAnalysisCancelled": "Cancelled the job analysis",
  "backgroundTasks.hint.keepsRunning":
    "It keeps running after you close the window; a dialog and a chime will tell you when it finishes.",
  // ── Standing task bar ──────────────────────────────────────
  "backgroundTasks.bar.heading": "Running now",
  "backgroundTasks.bar.view": "View",
  "backgroundTasks.bar.cancelAria": "Cancel {label}",
  "backgroundTasks.bar.elapsed": "Running for {seconds}s",
  "backgroundTasks.bar.generating": "Generating...",
  // ── Risk scan notifications ────────────────────────────────
  "backgroundTasks.risk.running.title": "Risk scan in progress",
  "backgroundTasks.risk.running.description":
    "You can leave this page; the scan keeps running in the background",
  "backgroundTasks.risk.done.title": "Risk scan complete",
  "backgroundTasks.risk.done.description": "{count} risk points found",
  "backgroundTasks.risk.failed.title": "Risk scan failed",
  "backgroundTasks.risk.failed.description": "Go back to the Resume preview and scan again.",
  "backgroundTasks.risk.stateFailed": "Risk scan failed. Try again",
  // ── Job suggestions notifications ──────────────────────────
  "backgroundTasks.suggestion.running.title": "Generating job suggestions",
  "backgroundTasks.suggestion.running.description":
    "You can leave this page; generation keeps running in the background",
  "backgroundTasks.suggestion.done.title": "Job suggestions ready",
  "backgroundTasks.suggestion.done.description":
    "Go back to the Resume detail and click “{action}” to see them.",
  "backgroundTasks.suggestion.failed.title": "Could not generate job suggestions",
  "backgroundTasks.suggestion.failed.description":
    "Go back to the Resume detail and generate again.",
  // ── Resume generation notices ──────────────────────────────
  "backgroundTasks.resume.done.title": "Resume generated",
  "backgroundTasks.resume.done.description":
    "Saved to Resume Center; you can keep fine-tuning or export it.",
  "backgroundTasks.resume.restored.description":
    "The generation you started before the refresh is done, and the Resume is saved to Resume Center.",
  "backgroundTasks.resume.failed.title": "Resume generation failed",
  "backgroundTasks.resume.failed.description": "Go back to Resume Center and try again.",
  "backgroundTasks.resume.cancelled.title": "Resume generation cancelled",
  "backgroundTasks.status.unknownDetail":
    "Task status unknown: the backend may have restarted or the record was cleaned up",
  "backgroundTasks.error.taskRecordGone": "This task record no longer exists",
  "backgroundTasks.confirm.gotIt": "Got it",
  // ── "You left, but it finished" notices ────────────────────
  "backgroundTasks.announce.completed": "{label} completed",
  "backgroundTasks.announce.completedHint": "The result is ready; go back to the page you were on.",
  "backgroundTasks.announce.failed": "{label} failed",
  "backgroundTasks.announce.failedHint": "Go back to the page you were on and try again.",
  // ── Job analysis ───────────────────────────────────────────
  "backgroundTasks.jobAnalysis.completedHint":
    "Go back to the Job detail and click “{action}” to see it.",
  "backgroundTasks.jobAnalysis.stateFailed": "Could not generate the job analysis. Try again later",
  // ── Bulk job fit analysis ──────────────────────────────────
  "backgroundTasks.jobMatch.done.title": "Job fit analysis complete",
  "backgroundTasks.jobMatch.done.description":
    "Finished {completed} jobs, {failed} failed; the results are saved in the analysis history.",
  "backgroundTasks.jobMatch.action.viewResults": "View results",
  "backgroundTasks.jobMatch.failed.title": "Job fit analysis failed",
  "backgroundTasks.jobMatch.failed.description": "Try again later.",
  "backgroundTasks.jobMatch.cancelled.title": "Job fit analysis cancelled",
  "backgroundTasks.jobMatch.cancelled.description":
    "Results finished before the cancellation are still saved.",
  "backgroundTasks.jobMatch.label": "Analysing {count} jobs",
  // ── Apply / collect batch notifications ────────────────────
  "backgroundTasks.batch.kindApply": "Apply",
  "backgroundTasks.batch.kindCollect": "Collect",
  "backgroundTasks.batch.kindFallback": "Task",
  "backgroundTasks.batch.statsApply": "{succeeded} succeeded · {failed} failed · {skipped} skipped",
  "backgroundTasks.batch.statsCollect": "{succeeded} jobs saved · {skipped} skipped",
  "backgroundTasks.batch.completed": "{kind} batch #{id} completed",
  "backgroundTasks.batch.failed": "{kind} batch #{id} failed",
  "backgroundTasks.batch.stopped": "{kind} batch #{id} stopped",
  "backgroundTasks.batch.failed.hint": "Check the apply desk for the failure reason",
  "backgroundTasks.batch.clickToView": " (Click to open the apply desk)",
} as const;

export default backgroundTasks;
