// SPDX-License-Identifier: Apache-2.0
/**
 * Job list table: column titles, sort hints, the job-name cell, row action menu and the
 * pagination total.
 *
 * The values of `STATUS_LABELS` ("开放中") are stored data values and the lookup key into
 * `JOB_STATUS_META`, not UI copy: turning them into locale keys would make the Tag miss
 * its color and label (silently falling back to `default`). That normalization stays in
 * the component; localizing the status label itself requires converting
 * `JOB_STATUS_META` in `types/job.ts` to labelKeys first (separate batch).
 */
const jobTable = {
  "jobTable.column.favorite": "Favorite",
  "jobTable.column.title": "Job",
  "jobTable.column.company": "Company",
  "jobTable.column.location": "City",
  "jobTable.column.salary": "Salary",
  "jobTable.column.jobType": "Type",
  "jobTable.column.status": "Status",
  "jobTable.column.note": "Note",
  "jobTable.column.postedAt": "Posted",
  "jobTable.column.actions": "Actions",
  "jobTable.action.favorite": "Favorite this job",
  "jobTable.action.unfavorite": "Remove from favorites",
  "jobTable.action.detail": "Details",
  "jobTable.action.generate": "Generate resume",
  "jobTable.action.write": "Write it myself",
  "jobTable.action.resumes": "Related resumes",
  "jobTable.action.edit": "Edit",
  "jobTable.sort.title": "Sort by job title",
  "jobTable.sort.company": "Sort by company name",
  "jobTable.sort.postedAt": "Sort by posting date (jobs without one use their import date)",
  "jobTable.tooltip.importedAt": "Imported at {time}",
  "jobTable.source.collected": "Collected",
  "jobTable.source.manual": "Manual",
  "jobTable.note.imageCount": "{count} images",
  "jobTable.note.imageHint": "The note has {count} images - open the details to view them",
  "jobTable.pagination.total": "{total} jobs in total",
} as const;

export default jobTable;
