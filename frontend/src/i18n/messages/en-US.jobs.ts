// SPDX-License-Identifier: Apache-2.0
/**
 * Job leads: the batch-selection toolbar (scope, count, export and delete actions).
 * Job board: the row "Copy" submenu (ledger item 13; same mechanism as the resume list).
 *
 * The existing `jobs.candidate.*` copy lives in the core pack; this pack adds only
 * the toolbar and copy-menu copy.
 */
const jobs = {
  "jobs.candidate.batchToolbar.aria": "Job lead batch toolbar",
  "jobs.candidate.batchToolbar.selectPage": "Select this page",
  "jobs.candidate.batchToolbar.selectedCount": "{selected} of {total} selected",
  "jobs.candidate.batchToolbar.selectAllTooltip":
    "Select all {count} matching Job leads in one click (across pages, not just this page)",
  "jobs.candidate.batchToolbar.selectAll": "Select all",
  "jobs.candidate.batchToolbar.exportCsv": "Export CSV",
  "jobs.candidate.batchToolbar.delete": "Delete selected",
  "jobs.candidate.batchToolbar.clear": "Clear selection",
  "jobs.candidate.batchToolbar.exit": "Exit selection mode",

  "jobs.copy.menu": "Copy",
  "jobs.copy.title": "Copy job title",
  "jobs.copy.company": "Copy company",
  "jobs.copy.location": "Copy city",
  "jobs.copy.salary": "Copy salary",
  "jobs.copy.url": "Copy link",
  "jobs.copy.note": "Copy note",
  "jobs.copy.jd": "Copy full JD",
  "jobs.copy.row": "Copy the row as one line for a spreadsheet",
  "jobs.copy.done": "Copied {field}",
  "jobs.copy.failed": "Could not copy; select the text and press Ctrl+C",
  "jobs.copy.jdFailed": "Could not fetch the JD; open the job detail and copy it there",
  "jobs.copy.field.title": "job title",
  "jobs.copy.field.company": "company",
  "jobs.copy.field.location": "city",
  "jobs.copy.field.salary": "salary",
  "jobs.copy.field.url": "link",
  "jobs.copy.field.note": "note",
  "jobs.copy.field.jd": "full JD",
  "jobs.copy.field.row": "entire row",
} as const;

export default jobs;
