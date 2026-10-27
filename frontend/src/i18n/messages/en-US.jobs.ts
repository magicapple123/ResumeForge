// SPDX-License-Identifier: Apache-2.0
/**
 * Job leads: the batch-selection toolbar (scope, count, export and delete actions).
 *
 * The existing `jobs.candidate.*` copy lives in the core pack; this pack adds only
 * the toolbar copy.
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
} as const;

export default jobs;
