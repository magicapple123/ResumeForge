// SPDX-License-Identifier: Apache-2.0
/**
 * The interview-experience library panel: search and source filters, entry summaries, the
 * row menu, batch deletion and the detail drawer.
 *
 * The question preview joins items with `；` in Chinese - that separator is pure
 * presentation and travels as `separator.question` ("; " in English). Source tag labels
 * still come from `EXPERIENCE_SOURCE_LABELS` in `types` (that protocol-value table is out
 * of scope for this batch).
 */
const interviewExperience = {
  "interviewExperience.title": "Interview experience library",
  "interviewExperience.searchPlaceholder": "Search the title, job or content",
  "interviewExperience.sourcePlaceholder": "Filter by source",
  "interviewExperience.action.create": "New interview note",
  "interviewExperience.action.detail": "Details",
  "interviewExperience.action.edit": "Edit",
  "interviewExperience.deleteNoun": "interview notes",
  "interviewExperience.empty": "No interview notes yet - record the questions you were asked",
  "interviewExperience.untitled": "Untitled interview note",
  "interviewExperience.confirm.delete": "Delete this interview note?",
  "interviewExperience.aria.select": "Select interview note {name}",
  "interviewExperience.aria.more": "More actions for {name}",
  "interviewExperience.questions.preview": "{count} real questions:",
  "interviewExperience.separator.question": "; ",
  "interviewExperience.field.job": "Linked job",
  "interviewExperience.field.createdAt": "Created",
  "interviewExperience.field.updatedAt": "Updated",
  "interviewExperience.section.content": "Content",
  "interviewExperience.section.questions": "Real questions ({count})",
  "interviewExperience.empty.content": "(None)",
  "interviewExperience.empty.questions": "(no question recorded yet)",
  "interviewExperience.toast.updated": "Interview note updated",
  "interviewExperience.toast.created": "Interview note created",
  "interviewExperience.toast.deleted": "Deleted this interview note",
  "interviewExperience.toast.batchDeleted":
    "Deleted {count} interview notes - restore them from the trash",
  "interviewExperience.error.loadFailed": "Could not read the interview notes",
  "interviewExperience.error.saveFailed": "Could not save the interview note",
  "interviewExperience.error.deleteFailed": "Delete failed",
  "interviewExperience.error.batchDeleteFailed": "Batch delete failed, try again",
} as const;

export default interviewExperience;
