// SPDX-License-Identifier: Apache-2.0
/**
 * The apply-records panel: the record table grouped by apply run (column headers, row
 * actions, soft-delete confirmation, re-apply, empty state and pagination).
 *
 * Status tags and failure categories still come from the `types` mapping tables
 * (protocol values to display names) and are out of scope for this pack.
 */
const applyRecords = {
  "applyRecords.column.job": "Job",
  "applyRecords.column.result": "Result",
  "applyRecords.column.failureKind": "Failure type",
  "applyRecords.column.resume": "Resume",
  "applyRecords.column.greeting": "Greeting",
  "applyRecords.column.finishedAt": "Applied at",
  "applyRecords.column.actions": "Actions",
  "applyRecords.deletedJob": "(Job deleted)",
  "applyRecords.defaultGreeting": "(default)",
  "applyRecords.action.retry": "Re-apply",
  "applyRecords.action.viewDetail": "View details",
  "applyRecords.retryHint":
    "Apply again with this record as the only target (dedupe and the daily limit still apply)",
  "applyRecords.confirm.deleteRecord":
    "Delete this apply record? It moves to Trash and can be restored; it also drops out of the stats and the daily limit.",
  "applyRecords.deleteNoun": "apply records",
  "applyRecords.empty": "No apply records yet",
  "applyRecords.pagination.total": "{count} batches in total",
  "applyRecords.toast.retried": "Created a new retry run",
  "applyRecords.toast.retriedFailed": "Retried {count} failed records",
  "applyRecords.toast.movedToTrash": "Moved to Trash",
  "applyRecords.toast.batchDeleted": "Deleted {count} apply records - restore them from the trash",
  "applyRecords.error.retryFailed": "Could not re-apply",
  "applyRecords.error.retryFailedBatch": "Batch retry failed",
  "applyRecords.error.deleteFailed": "Delete failed",
  "applyRecords.error.batchDeleteFailed": "Batch delete failed, try again",

  "applyRecords.stale.title": "{count} applications without a reply for 7+ days",
  "applyRecords.stale.body":
    "Click Mark all as in progress to record them in Job tracker, then update their stage there.",
  "applyRecords.stale.markAll": "Mark all as in progress",
  "applyRecords.stale.view": "Show these {count}",
  "applyRecords.stale.hide": "Hide",
  "applyRecords.stale.line": "{title} | {company} | applied {days} days ago",
  "applyRecords.stale.done": "Marked {count} applications as in progress",
  "applyRecords.stale.partial": "{ok} recorded, {failed} failed - try again",
  "applyRecords.action.track": "Update progress",
  "applyRecords.track.hint":
    "Records an entry in Job tracker (reused when it already exists), where you can update the stage",
  "applyRecords.toast.tracked": "Recorded this application in Job tracker",
  "applyRecords.toast.trackUpdated": "Updated this application in Job tracker",
  "applyRecords.error.trackFailed": "Could not record it in Job tracker, try again",
} as const;

export default applyRecords;
