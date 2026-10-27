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
  "applyRecords.toast.movedToTrash": "Moved to Trash",
  "applyRecords.toast.batchDeleted": "Deleted {count} apply records - restore them from the trash",
  "applyRecords.error.retryFailed": "Could not re-apply",
  "applyRecords.error.deleteFailed": "Delete failed",
  "applyRecords.error.batchDeleteFailed": "Batch delete failed, try again",
} as const;

export default applyRecords;
