// SPDX-License-Identifier: Apache-2.0
/**
 * Jobs page (`pages/jobs/**`): the filter toolbar, the batch action bar, batch action
 * toasts and the confirmation chain for adding one job to the apply queue.
 *
 * The table view and row actions live in `en-US.jobTable.ts`; the source badges'
 * display names live there too.
 */
const jobsPage = {
  "jobsPage.toolbar.selectedCount": "{count} jobs selected",
  "jobsPage.toolbar.selectAllTooltip":
    "Select all {count} jobs matching the current filters in one click (across pages, not just this page)",
  "jobsPage.toolbar.selectAllButton": "Select all jobs ({count} total)",
  "jobsPage.toolbar.exitSelection": "Exit selection",
  "jobsPage.toolbar.clearSelection": "Clear selection",
  "jobsPage.toolbar.statusPlaceholder": "Set status in bulk",
  "jobsPage.toolbar.applyStatus": "Apply status",
  "jobsPage.toolbar.enqueueTooltip":
    "Fast apply: add directly to the apply queue (unanalyzed jobs and real gaps skip the per-job confirmations); jobs from unsupported sources are skipped automatically and noted in the results",
  "jobsPage.toolbar.enqueue": "Add to apply queue",
  "jobsPage.toolbar.exportCsv": "Export CSV",
  "jobsPage.toolbar.exportFileName": "jobs-{stamp}.csv",
  "jobsPage.toolbar.exported": "Exported {count} jobs",
  "jobsPage.toolbar.exportFailed": "Export failed",
  "jobsPage.toolbar.delete": "Delete selected",

  "jobsPage.filter.searchPlaceholder": "Search jobs / companies / cities / descriptions / notes",
  "jobsPage.filter.jobTypeAria": "Filter by job type",
  "jobsPage.filter.jobTypePlaceholder": "Type",
  "jobsPage.filter.statusAria": "Filter by job status",
  "jobsPage.filter.statusPlaceholder": "Status",
  "jobsPage.filter.sourceAria": "Filter by source",
  "jobsPage.filter.sourcePlaceholder": "Source",
  "jobsPage.filter.analyzeMatch": "AI match analysis",
  "jobsPage.filter.matchHistory": "Analysis history",
  "jobsPage.filter.candidates": "Job leads",
  "jobsPage.filter.backfill": "Fill in details",
  "jobsPage.filter.importCsv": "Import CSV",
  "jobsPage.filter.addManual": "Add manually",
  "jobsPage.filter.sortResetHintDefault":
    "Already using the default order: most recently imported first",
  "jobsPage.filter.sortResetHint": "Restore the default order: most recently imported first",
  "jobsPage.filter.sortReset": "Restore default order",
  "jobsPage.filter.sourceCollected": "Collected automatically",
  "jobsPage.filter.sourceManual": "Added manually",

  "jobsPage.batch.needSelection": "Select jobs first",
  "jobsPage.batch.needStatus": "Select a status to apply",
  "jobsPage.batch.statusUpdated": "Updated the status of {count} jobs",
  "jobsPage.batch.statusUpdateFailed": "Could not update the job statuses",
  "jobsPage.batch.deletePartial":
    "Deleted {deleted} jobs; {failed} could not be deleted. You can restore deleted jobs from the Trash",
  "jobsPage.batch.deleted": "Deleted {deleted} jobs; you can restore them from the Trash",
  "jobsPage.batch.deleteFailed": "Could not delete the selected jobs",
  "jobsPage.batch.enqueueFailed": "Could not add the jobs to the apply queue",

  "jobsPage.queue.added": "Added to the apply queue",
  "jobsPage.queue.unsupportedTitle": "This job cannot be auto-applied",
  "jobsPage.queue.unsupportedOk": "Got it",
  "jobsPage.queue.unanalyzedTitle": "This job has no match analysis yet",
  "jobsPage.queue.unanalyzedContent":
    "We recommend running Match analysis first. You can also add it to the queue now; eligibility is checked again before applying.",
  "jobsPage.queue.unanalyzedOk": "Add anyway",
  "jobsPage.queue.realGapTitle": "This job has real gaps, so it is not applied to by default",
  "jobsPage.queue.realGapContent":
    "Match analysis found that you genuinely lack these requirements: {gaps}. Apply to this job anyway?",
  "jobsPage.queue.gapSeparator": ", ",
  "jobsPage.queue.realGapOk": "Apply anyway",
  "jobsPage.queue.addFailed": "Could not add it to the apply queue",

  "jobsPage.detail.loadFailed": "This job no longer exists or has been deleted",

  "jobsPage.selectAll.empty": "No jobs match the current filters",
  "jobsPage.selectAll.overLimit":
    "The current filters match {count} jobs, over the {limit}-job per-batch limit. Narrow the range with filters or search first.",
  "jobsPage.selectAll.done": "Selected all {count} jobs matching the current filters (all pages)",
  "jobsPage.selectAll.failed": "Could not load the job list",
} as const;

export default jobsPage;
