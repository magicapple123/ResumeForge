// SPDX-License-Identifier: Apache-2.0
/**
 * Fact ledger page: title, summary statistics, filters, the entry list and the
 * delete / confirm feedback.
 *
 * The Chinese category and verification-status values are protocol values (defined in
 * `types/claim.ts`, submitted to the backend and validated there). Only their display
 * names are mapped to keys: `CATEGORY_LABEL_KEYS` / `STATUS_LABEL_KEYS` are keyed by the
 * protocol value and hold locale keys, resolved with `t(MAP[value])`. `types/claim.ts` is
 * untouched.
 */
const claimsPage = {
  "claimsPage.title": "Fact ledger",
  "claimsPage.subtitle":
    "Every statement you make in public can be traced back to a source. Only confirmed entries become facts when a resume is generated; all other wording is explicitly avoided.",
  "claimsPage.action.drill": "Start deep dive",
  "claimsPage.action.fromProfile": "Generate from profile",
  "claimsPage.action.create": "New entry",
  "claimsPage.stat.total": "Total entries",
  "claimsPage.stat.confirmed": "Confirmed (usable in a final resume)",
  "claimsPage.stat.pending": "Pending",
  "claimsPage.stat.baseline": "Facts usable at generation",
  "claimsPage.stat.blocked": "Unconfirmed wording that is avoided",
  "claimsPage.filter.categoryAria": "Fact category filter",
  "claimsPage.filter.statusAria": "Fact verification status filter",
  "claimsPage.filter.allCategories": "All categories",
  "claimsPage.filter.allStatuses": "All statuses",
  "claimsPage.filter.countSuffix": " ({count})",
  "claimsPage.filter.searchPlaceholder": "Search the title, subject, fact or wording",
  "claimsPage.status.confirmed": "Confirmed",
  "claimsPage.status.pending": "Pending",
  "claimsPage.status.expired": "Expired",
  "claimsPage.status.rejected": "Not used",
  "claimsPage.category.education": "Education",
  "claimsPage.category.internship": "Internship / work",
  "claimsPage.category.project": "Projects",
  "claimsPage.category.campus": "Campus activities",
  "claimsPage.category.skills": "Skills",
  "claimsPage.category.awards": "Awards",
  "claimsPage.category.other": "Other",
  "claimsPage.deleteNoun": "ledger entries",
  "claimsPage.empty.filtered": "No entry matches the filters",
  "claimsPage.empty.initial":
    "The fact ledger is still empty. Generate a batch of drafts from your profile, or create one by hand.",
  "claimsPage.pagination.total": "{count} in total",
  "claimsPage.toast.confirmed": "Marked as confirmed",
  "claimsPage.toast.confirmedWithTodo": "Marked as confirmed, but to-dos remain: {warning}",
  "claimsPage.error.confirmFailed": "Could not mark it as confirmed",
  "claimsPage.toast.batchDeleted": "Deleted {count} ledger entries - restore them from the trash",
  "claimsPage.error.batchDeleteFailed": "Batch delete failed, try again",
  "claimsPage.error.deleteFailed": "Delete failed",
  "claimsPage.error.loadFailed": "Could not load the entry",
} as const;

export default claimsPage;
