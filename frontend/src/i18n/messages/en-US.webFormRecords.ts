// SPDX-License-Identifier: Apache-2.0
/**
 * Web-form "fill records" panel: list summaries, the detail table, batch deletion and
 * pagination.
 *
 * The `ITEM_STATUS_META` keys (filled / unverified / failed / skipped / conflict) are
 * protocol values; only the display name moves to `labelKey`. `TRASH_RECOVERY_NOTE` is a
 * shared Chinese constant owned elsewhere - this file only references it.
 */
const webFormRecords = {
  "webFormRecords.column.field": "Field",
  "webFormRecords.column.value": "Filled value",
  "webFormRecords.column.status": "Result",
  "webFormRecords.status.filled": "Filled in",
  "webFormRecords.status.unverified": "Needs check",
  "webFormRecords.status.failed": "Failed",
  "webFormRecords.status.skipped": "Skipped",
  "webFormRecords.status.conflict": "Conflict",
  "webFormRecords.action.deleteSelected": "Delete selected",
  "webFormRecords.confirm.batchTitle": "Delete the selected fill records?",
  "webFormRecords.confirm.batchBody": "These {count} fill records {note}",
  "webFormRecords.confirm.deleteOne":
    "Delete this fill record? It goes to the trash and can be restored later.",
  "webFormRecords.toast.deleted": "Deleted {count} fill records",
  "webFormRecords.toast.partialDeleted": "Deleted {done}, {failed} failed - try again",
  "webFormRecords.error.load": "Could not read the fill records",
  "webFormRecords.empty.none": "No fill records yet",
  "webFormRecords.aria.selectRecord": "Select fill record {id}",
  "webFormRecords.untitled": "(untitled)",
  "webFormRecords.tag.filled": "Filled {count}",
  "webFormRecords.tag.unverified": "Check {count}",
  "webFormRecords.tag.failed": "Failed {count}",
  "webFormRecords.tag.live": "Field by field",
  "webFormRecords.field.page": "Page",
  "webFormRecords.table.empty": "No fillable field in this run",
  "webFormRecords.snapshot.summary":
    "After filling, {filled} boxes on the page were filled by us; the rest is your own content or computed by the page itself.",
  "webFormRecords.pagination.total": "{count} in total",
} as const;

export default webFormRecords;
