// SPDX-License-Identifier: Apache-2.0
/**
 * Candidate job card grid (`CandidateCardGrid`) and its batch actions
 * (`useCandidateBatchTools`): card status and source values, single-card context
 * menu actions, and the export / batch-delete result toasts.
 */
const jobsCandidate = {
  "jobsCandidate.card.viewDetail": "View details",
  "jobsCandidate.card.untitled": "(No job title)",
  "jobsCandidate.card.statusImported": "Imported",
  "jobsCandidate.card.deleteConfirm": "Delete this Job lead?",
  "jobsCandidate.card.images": "{count} screenshots",
  "jobsCandidate.card.rawLength": "Source text: {count} characters",
  "jobsCandidate.card.updatedAt": "Updated {time}",
  "jobsCandidate.batch.emptyFiltered": "No Job leads match this filter",
  "jobsCandidate.batch.overLimit":
    "There are {count} Job leads under this filter, over the 5000 per-batch limit - narrow the range with search first",
  "jobsCandidate.batch.selectAllDone":
    "Selected all {count} Job leads under this filter (all pages)",
  "jobsCandidate.batch.loadFailed": "Could not load the Job lead list",
  "jobsCandidate.batch.exportFileName": "job-leads-{stamp}.csv",
  "jobsCandidate.batch.exported": "Exported {count} Job leads",
  "jobsCandidate.batch.exportFailed": "Could not export",
  "jobsCandidate.batch.needSelection": "Select Job leads first",
  "jobsCandidate.batch.deletePartial": "Deleted {deleted} Job leads, {failed} failed to delete",
  "jobsCandidate.batch.deleted": "Deleted {deleted} Job leads",
  "jobsCandidate.batch.deleteFailed": "Could not delete the selected Job leads",
} as const;

export default jobsCandidate;
