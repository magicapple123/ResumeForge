// SPDX-License-Identifier: Apache-2.0
/**
 * Results of one collection (Apply page · automatic collection): table, import actions,
 * per-item feedback and the bulk-enqueue path.
 *
 * `outcome` values stay untranslated protocol values in the component; only their display
 * copy lives here. The two `success` strings end with a comma on purpose — a jump button
 * follows them and i18n has no rich-text interpolation.
 */
const collectResult = {
  "collectResult.title": "Results of this collection",
  "collectResult.hint":
    "Select the jobs to add to your Job Pool. Anything you leave unselected stays in Candidate Jobs, so you can pick it later.",
  "collectResult.empty":
    "Nothing to import from this collection yet (everything may already be imported, or nothing was collected)",

  "collectResult.column.title": "Job",
  "collectResult.column.location": "City",
  "collectResult.column.salary": "Salary",
  "collectResult.column.source": "Source site",
  "collectResult.action.openSource": "View",

  "collectResult.row.unknownTitle": "(Job title not recognized)",
  "collectResult.row.unknownCompany": "(Company not recognized)",

  "collectResult.outcome.duplicate":
    "This job is already in your Job Pool (linked to the existing entry, no duplicate created)",
  "collectResult.outcome.trashed":
    "A job with this title is already in the Job Pool Trash — restore it from Trash first, or delete it permanently and import again",
  "collectResult.outcome.invalid": "This entry has no job title, so it cannot become a Job",
  "collectResult.outcome.missing":
    "This candidate no longer exists (it may have been deleted somewhere else)",

  "collectResult.problem.title": "{count} jobs were not created (the rest were handled)",

  "collectResult.import.label": "Import selected jobs",
  "collectResult.import.labelWithCount": "Import {count} selected jobs",
  "collectResult.import.success": "Imported {count} jobs into Job Pool, ",
  "collectResult.import.successAction": "View Job Pool",
  "collectResult.import.noneAdded":
    'No new jobs were added; see "{count} jobs were not created" for the reasons',
  "collectResult.import.failed": "Could not import the selected jobs",

  "collectResult.queue.tooltip":
    "Bulk-apply mode: import into Job Pool and add to the Apply Queue in one step (unanalyzed jobs are queued without a per-job confirmation; eligibility is still checked before applying)",
  "collectResult.queue.label": "Import and add to Apply Queue",
  "collectResult.queue.aria": "Import {count} selected jobs and add them to the Apply Queue",
  "collectResult.queue.nothingToQueue":
    "No jobs can be added to the Apply Queue (none of the selected jobs were imported into Job Pool)",
  "collectResult.queue.success": "Imported {count} jobs, {summary}, ",
  "collectResult.queue.successAction": "View Apply Queue",
  "collectResult.queue.failed": "Could not import and add to the Apply Queue",

  "collectResult.action.selectAll": "Select all",
  "collectResult.action.clearSelection": "Clear selection",
  "collectResult.footnote":
    "After importing, arrange the jobs you want in Apply Queue and start applying.",
} as const;

export default collectResult;
