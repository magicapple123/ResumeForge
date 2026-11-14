// SPDX-License-Identifier: Apache-2.0
/**
 * Resume Center page (`pages/ResumesPage.tsx`) and its controlled dialogs: the filter
 * toolbar, the sort reset, batch deletion, the select-all-resumes toasts and the rename /
 * note / version-compare dialogs.
 *
 * The table and card views keep their own copy in `en-US.resumes.ts` /
 * `en-US.responsive.ts`; the batch action bar (`BatchActionBar`) belongs to another
 * batch. The batch-delete body references `common.note.trashRecovery` through the
 * `{note}` placeholder instead of restating it.
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
  "resumesPage.batch.actions": "Bulk actions",
  "resumesPage.batch.export": "Export selected",
  "resumesPage.batchDelete.button": "Delete selected",
  "resumesPage.batchDelete.title": "Delete the selected resumes?",
  "resumesPage.batchDelete.body": "Delete these {count} resumes. {note}",
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

  // ── External resumes (item 21: read-only snapshots) ──────
  "resumesPage.external.title": "External resumes",
  "resumesPage.external.back": "Back to resume center",
  "resumesPage.external.entry": "External resumes",
  "resumesPage.external.entryWithCount": "External resumes {count}",
  "resumesPage.external.subtitle":
    "Read-only snapshots you cannot edit; usable for mock interviews and text checks",
  "resumesPage.external.tag": "External",
  "resumesPage.external.upload": "Upload external resume",
  "resumesPage.external.empty": "No external resumes yet",
  "resumesPage.external.emptyHint":
    "Upload a PDF / Word / TXT / Markdown resume you created elsewhere: preview the original, run text checks and reuse it in mock interviews",
  "resumesPage.external.chars": "{count} chars",
  "resumesPage.external.noText": "No text extracted",
  "resumesPage.external.jobTag": "Related job: {job}",
  "resumesPage.external.preview": "Preview original",
  "resumesPage.external.viewText": "View text",
  "resumesPage.external.check": "Text check",
  "resumesPage.external.useForInterview": "Use for interview",
  "resumesPage.external.noTextForInterview":
    "No text was extracted from this resume, so it cannot be reused directly; upload the original on the interview page to let the recognition pipeline handle it",
  "resumesPage.external.delete": "Delete",
  "resumesPage.external.deleted": "Deleted “{name}”",
  "resumesPage.external.deleteFailed": "Could not delete it, try again",
  "resumesPage.external.restored": "Restored “{name}”",
  "resumesPage.external.restoreFailed": "Could not restore it; restore it from the Trash manually",
  "resumesPage.external.loadFailed": "Could not load external resumes",
  "resumesPage.external.uploadTitle": "Upload external resume",
  "resumesPage.external.uploadName": "Display name",
  "resumesPage.external.uploadNamePlaceholder": "Defaults to the file name",
  "resumesPage.external.uploadJob": "Related job (optional)",
  "resumesPage.external.uploadJobPlaceholder": "Pick the job this resume targets",
  "resumesPage.external.uploadDrop": "Drop a file here or click to choose",
  "resumesPage.external.uploadHint": "PDF / Word / TXT / Markdown, up to 10 MB each",
  "resumesPage.external.uploadRequired": "Choose a resume file first",
  "resumesPage.external.uploadUnsupported":
    "This file type is not supported; use PDF / Word / TXT / Markdown",
  "resumesPage.external.uploading": "Uploading and extracting text…",
  "resumesPage.external.uploaded": "Uploaded “{name}”",
  "resumesPage.external.uploadedNoText": "Saved “{name}” but no text was extracted",
  "resumesPage.external.uploadFailed": "Upload failed, try again",
  "resumesPage.external.detailTitle": "External resume",
  "resumesPage.external.tabOriginal": "Original",
  "resumesPage.external.tabText": "Text",
  "resumesPage.external.tabCheck": "Text check",
  "resumesPage.external.originalUnsupported":
    "This format cannot be previewed in the browser; download it and open it locally",
  "resumesPage.external.downloadOriginal": "Download original",
  "resumesPage.external.textEmpty": "No text was extracted from this file",
  "resumesPage.external.textTruncated": "Only the first part of the text is stored",
  "resumesPage.external.checkHint":
    "Text-level checks only; layout and field completeness are not checked and there is no total score",
  "resumesPage.external.checkStatusOk": "OK",
  "resumesPage.external.checkStatusWarn": "Needs attention",
  "resumesPage.external.checkStatusInfo": "FYI",
  "resumesPage.external.checkNoText": "No text was extracted, so there is nothing to check",
  "resumesPage.external.checkLoading": "Checking…",
  "resumesPage.external.checkFailed": "Text check failed",
  "resumesPage.external.checkPlaceholder": "Unfinished placeholders",
  "resumesPage.external.checkQuantification": "Quantified lines",
  "resumesPage.external.checkContact": "Contact details",
  "resumesPage.external.checkLength": "Length",
  "resumesPage.external.checkWeakWording": "Weak wording",
  "resumesPage.external.checkKeywords": "Keyword coverage",
  "resumesPage.external.checkPlaceholderDetail": "{count} unfinished markers found",
  "resumesPage.external.checkPlaceholderOk": "No unfinished markers found",
  "resumesPage.external.checkQuantificationDetail":
    "{count} of {total} lines contain numbers or percentages ({ratio}%)",
  "resumesPage.external.checkContactDetail": "{count} contact details found",
  "resumesPage.external.checkContactMissing": "No phone number or email found",
  "resumesPage.external.checkLengthDetail": "{chars} chars in {lines} lines (~{pages} pages)",
  "resumesPage.external.checkWeakWordingDetail":
    "{count} of {total} lines start with weak wording such as “was responsible for” ({ratio}%)",
  "resumesPage.external.checkWeakWordingOk": "No weak wording found",
  "resumesPage.external.checkKeywordsDetail":
    "{matched} of {target} target keywords covered ({ratio}%)",
  "resumesPage.external.checkKeywordsMissing": "Missing: {words}",
  "resumesPage.external.lineWithText": "Line {line}: {text}",
  "resumesPage.external.searchPlaceholder": "Search name, job or company",
  "resumesPage.external.total": "{count} resumes",
  "resumesPage.external.filteredTotal": "{count} matching resumes",
  "resumesPage.external.noMatches": "No matching external resumes",
  "resumesPage.external.clearFilters": "Clear filters",
  "resumesPage.external.limited": "Showing the latest {count}; search to find other resumes",
  "resumesPage.external.uploadFiltersCleared": "Filters cleared to show the uploaded resume",
} as const;

export default resumesPage;
