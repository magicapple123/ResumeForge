// SPDX-License-Identifier: Apache-2.0
/**
 * Resume Center page (`pages/ResumesPage.tsx`): the filter toolbar, the sort reset,
 * batch deletion and the one-off toasts that belong to the page rather than to a list.
 *
 * The table and card views keep their own copy in `en-US.resumes.ts` /
 * `en-US.responsive.ts`; the batch action bar (`BatchActionBar`) and the Job filter
 * select (`JobFilterSelect`) belong to other batches. The batch-delete body references
 * `TRASH_RECOVERY_NOTE` through the `{note}` placeholder instead of restating it.
 */
const resumesPage = {
  "resumesPage.page.newResume": "New resume",
  "resumesPage.page.deliveryArchive": "Delivery archive",
  "resumesPage.page.jobFilterTag": "Filtered by job: {job}",
  "resumesPage.page.clearFilter": "Clear filter",
  "resumesPage.filter.jobRelation": "Job association",
  "resumesPage.filter.jobRelationAria": "Filter by job association",
  "resumesPage.filter.hasJob": "Has a target job",
  "resumesPage.filter.general": "General Resume",

  "resumesPage.sort.reset": "Restore default sort",

  "resumesPage.selectAll.tooltip":
    "Select all {count} matching resumes in one click (across pages, not just this page)",
  "resumesPage.selectAll.button": "Select all resumes ({count} total)",
  "resumesPage.batchDelete.button": "Delete selected",
  "resumesPage.batchDelete.title": "Delete the selected resumes?",
  "resumesPage.batchDelete.body": "These {count} resumes {note}",
  "resumesPage.batchDelete.done": "Deleted {count} resumes — restore them from the Trash",

  "resumesPage.toast.movedToTrash": "Moved to the Trash — you can restore it there",
  "resumesPage.error.deleteFailed": "Delete failed",
  "resumesPage.error.favoriteUpdateFailed": "Could not update the favorite status",
  "resumesPage.error.batchDeleteFailed": "Batch delete failed, try again",
  "resumesPage.rename.required": "The resume name cannot be empty",
  "resumesPage.rename.done": "Renamed",
  "resumesPage.rename.failed": "Rename failed",
  "resumesPage.diff.failed": "Could not compare the versions",
  "resumesPage.note.saved": "Note saved",
  "resumesPage.note.saveFailed": "Could not save the note",
} as const;

export default resumesPage;
