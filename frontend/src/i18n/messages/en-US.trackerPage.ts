// SPDX-License-Identifier: Apache-2.0
/**
 * Job tracker page: header copy, summary readings, funnel, filters, empty states, pagination.
 *
 * The funnel and filter dropdowns do not carry their status names here. Those seven names map
 * a protocol value (`applied` / `screening` …) to a display name in `types/tracker.ts` and are
 * shared with the tracker entry form, so `TRACK_STATUS_LABEL_KEYS` in `TrackerPage.tsx` points
 * straight at `trackerForm.status.*`: one protocol value must read the same in both places.
 */
const trackerPage = {
  "trackerPage.title": "Job tracker",
  "trackerPage.subtitle":
    "One record per company and role, moved forward as their messages arrive. Jobs sent from the apply console are recorded as Applied automatically; for anything later, paste in the message you received.",
  "trackerPage.action.reminders": "Reminders",
  "trackerPage.action.import": "Import from messages",
  "trackerPage.action.export": "Export",
  "trackerPage.action.create": "Add entry",
  "trackerPage.action.clearJobFilter": "Clear the Job filter",
  "trackerPage.export.csv": "Export CSV (opens directly in Excel)",
  "trackerPage.export.json": "Export JSON",
  "trackerPage.error.deleteFailed": "Delete failed",
  "trackerPage.error.exportFailed": "Export failed",
  "trackerPage.stats.error": "Could not load the summary: {error}",
  "trackerPage.stat.total": "Total",
  "trackerPage.stat.active": "In progress",
  "trackerPage.stat.month": "Applied this month",
  "trackerPage.stat.closed": "Closed",
  "trackerPage.funnel.tooltip": "{label}: {count} entries",
  "trackerPage.filter.statusAria": "Tracker status filter",
  "trackerPage.filter.allStatuses": "All statuses",
  "trackerPage.filter.searchPlaceholder": "Search company, role, notes or next step",
  "trackerPage.linkedJob.prefix": "Only applications for this Job: {label}",
  "trackerPage.linkedJob.unknownName": "Job #{id}",
  "trackerPage.linkedJob.deleted": "This Job may have been deleted",
  "trackerPage.empty.filtered": "No entry matches the filters",
  "trackerPage.empty.initial":
    "No tracker entries yet. Jobs sent from the apply console show up here automatically; you can also use Import from messages to bring in progress from your inbox.",
  "trackerPage.pagination.total": "{count} in total",
  "trackerPage.modal.reminderTitle": "Calendar reminders",
} as const;

export default trackerPage;
