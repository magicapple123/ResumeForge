// SPDX-License-Identifier: Apache-2.0
/**
 * Resume Center page (`pages/ResumesPage.tsx`) and its controlled dialogs: the filter
 * toolbar, the sort reset, batch deletion, the select-all-resumes toasts and the rename /
 * note / version-compare dialogs.
 *
 * The table and card views keep their own copy in `en-US.resumes.ts` /
 * `en-US.responsive.ts`; the batch action bar (`BatchActionBar`) belongs to another
 * batch. The batch-delete body references `TRASH_RECOVERY_NOTE` through the `{note}`
 * placeholder instead of restating it.
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

  "resumesPage.jobFilter.label": "Filter by job",

  "resumesPage.sort.reset": "Restore default sort",

  "resumesPage.selectAll.tooltip":
    "Select all {count} matching resumes in one click (across pages, not just this page)",
  "resumesPage.selectAll.button": "Select all resumes ({count} total)",
  "resumesPage.selectAll.empty": "No Resumes match the current filter",
  "resumesPage.selectAll.tooMany":
    "The current filter matches {count} Resumes, above the 5000-per-batch limit; narrow the filter or search first",
  "resumesPage.selectAll.done":
    "Selected all {count} Resumes matching the current filter (all pages)",
  "resumesPage.batchDelete.button": "Delete selected",
  "resumesPage.batchDelete.title": "Delete the selected resumes?",
  "resumesPage.batchDelete.body": "These {count} resumes {note}",
  "resumesPage.batchDelete.done": "Deleted {count} resumes — restore them from the Trash",

  "resumesPage.rename.title": "Rename Resume",
  "resumesPage.rename.namePlaceholder": "Resume title",
  "resumesPage.note.title": "Edit note",
  "resumesPage.note.placeholder": "The note appears in the Resume list (optional)",
  "resumesPage.diff.title": "Compare versions",
  "resumesPage.diff.baseLabel": "Base version:",
  "resumesPage.diff.againstLabel": "Compare:",
  "resumesPage.diff.againstPlaceholder": "Select a version to compare",
  "resumesPage.diff.emptyHint": "Select another Resume to see what changed.",

  "resumesPage.toast.movedToTrash": "Moved to the Trash — you can restore it there",
  "resumesPage.error.deleteFailed": "Delete failed",
  "resumesPage.error.favoriteUpdateFailed": "Could not update the favorite status",
  "resumesPage.error.batchDeleteFailed": "Batch delete failed, try again",
  "resumesPage.error.listFetchFailed": "Could not load the Resume list",
  "resumesPage.rename.required": "The resume name cannot be empty",
  "resumesPage.rename.done": "Renamed",
  "resumesPage.rename.failed": "Rename failed",
  "resumesPage.diff.failed": "Could not compare the versions",
  "resumesPage.note.saved": "Note saved",
  "resumesPage.note.saveFailed": "Could not save the note",
} as const;

export default resumesPage;
