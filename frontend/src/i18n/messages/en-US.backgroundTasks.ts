// SPDX-License-Identifier: Apache-2.0
/**
 * Header "Background tasks" indicator: each task row's progress and cancel/remove
 * actions, the popover title and its standing hint, and the action toasts.
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
} as const;

export default backgroundTasks;
