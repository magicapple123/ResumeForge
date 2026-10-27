// SPDX-License-Identifier: Apache-2.0
/**
 * Personalized question bank panel (the question bank tab under Interview): generate
 * entry, saved-record review, batch-delete confirmation and toasts.
 *
 * `TRASH_RECOVERY_NOTE` is a shared Chinese constant owned elsewhere - this file only
 * references it. Placeholder names and occurrence counts match the Chinese pack.
 */
const questionBankPanel = {
  "questionBankPanel.page.title": "Personalized question bank",
  "questionBankPanel.page.description":
    "Questions are generated on the spot from the job description, your resume, and your confirmed fact ledger - covering basics, project deep-dives, and questions to ask the interviewer.",
  "questionBankPanel.select.jobPlaceholder": "Related job (optional, type to search)",
  "questionBankPanel.select.resumePlaceholder": "Related resume (optional, type to search)",
  "questionBankPanel.action.generate": "Generate questions",
  "questionBankPanel.action.startSession": "Start mock interview",
  "questionBankPanel.action.save": "Save question bank",
  "questionBankPanel.action.regenerate": "Regenerate",
  "questionBankPanel.empty.needSelection": "Pick a job or resume to generate questions",
  "questionBankPanel.empty.recordEmpty": "This saved record is empty",
  "questionBankPanel.history.title": "Question bank history",
  "questionBankPanel.history.viewingTitle": "Viewing saved question bank #{id} ({time})",
  "questionBankPanel.history.legacyTitle": "Legacy record - view only",
  "questionBankPanel.history.legacyBody":
    "This record was saved as plain text, so it cannot be restored as a structured question bank. Only the original content is shown.",
  "questionBankPanel.summary.total": "{count} questions in total",
  "questionBankPanel.validate.needJobOrResume":
    "Pick at least one job or resume so the questions can be targeted",
  "questionBankPanel.error.generate": "Could not generate the question bank",
  "questionBankPanel.error.autoSave": "Could not save the question bank to history",
  "questionBankPanel.error.delete": "Could not delete the saved question bank",
  "questionBankPanel.error.answer": "Could not generate the sample answer",
  "questionBankPanel.error.answerWriteBack":
    "The sample answer was generated, but writing it back to the record failed",
  "questionBankPanel.confirm.bulkDeleteTitle": "Delete the selected saved question banks?",
  "questionBankPanel.confirm.bulkDeleteBody": "These {count} saved question banks {note}",
  "questionBankPanel.toast.deletedMany": "Deleted {count} saved question banks",
  "questionBankPanel.toast.deletedPartial": "Deleted {ok}; {failed} failed - try again",
  "questionBankPanel.toast.deleted": "Saved question bank deleted",
} as const;

export default questionBankPanel;
