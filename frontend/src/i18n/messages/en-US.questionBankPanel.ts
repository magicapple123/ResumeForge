// SPDX-License-Identifier: Apache-2.0
/**
 * Personalized question bank panel (the question bank tab under Interview): generate
 * entry, question group cards, saved-record review, batch-delete confirmation and toasts.
 *
 * The batch body takes the shared `common.note.trashRecovery` through the `{note}`
 * placeholder. Placeholder names and occurrence counts match the Chinese pack.
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
  "questionBankPanel.confirm.bulkDeleteBody": "Delete these {count} saved question banks. {note}",
  "questionBankPanel.toast.deletedMany": "Deleted {count} saved question banks",
  "questionBankPanel.toast.deletedPartial": "Deleted {ok}; {failed} failed - try again",
  "questionBankPanel.toast.deleted": "Saved question bank deleted",
  "questionBankPanel.history.fallbackTitle": "Question bank",
  "questionBankPanel.history.total": "{count} in total",
  "questionBankPanel.history.deleteTitle": "Delete this saved question bank?",
  "questionBankPanel.history.selectAria": "Select question bank {name}",
  "questionBankPanel.action.viewDetail": "View details",
  "questionBankPanel.action.deleteSelected": "Delete selected",
  "questionBankPanel.action.answer": "Sample answer",
  "questionBankPanel.action.showAnswer": "View sample answer",
  "questionBankPanel.action.generateAnswer": "Generate sample answer",
  "questionBankPanel.empty.noHistory": "No saved question banks yet",
  "questionBankPanel.group.basics": "Basic questions",
  "questionBankPanel.group.projectDeepDive": "Project deep-dives",
  "questionBankPanel.group.askInterviewer": "Questions for the interviewer",
  "questionBankPanel.group.purpose": "Purpose: {purpose}",
  "questionBankPanel.group.hintLabel": "Hint:",
  "questionBankPanel.group.samplePhrasing": "Sample wording: {text}",
  "questionBankPanel.action.hideAnswer": "Hide sample answer",
  "questionBankPanel.action.regenerateAnswer": "Regenerate",
  "questionBankPanel.error.reviewAnswer": "Could not review your answer",
  "questionBankPanel.group.keyPointsTitle": "Key points",
  "questionBankPanel.group.sampleTitle": "Sample wording",
  "questionBankPanel.group.sampleHint":
    "Swap the example for your own real experience before you speak.",
  "questionBankPanel.review.scoreUnit": "pts",
  "questionBankPanel.review.tone.good": "Ready to interview",
  "questionBankPanel.review.tone.fair": "Room to improve",
  "questionBankPanel.review.tone.weak": "Needs a rewrite",
  "questionBankPanel.review.noSummary": "No overall comment this time.",
  "questionBankPanel.review.strengths": "What worked",
  "questionBankPanel.review.gaps": "What fell short",
  "questionBankPanel.review.suggestions": "How to fix it",
  "questionBankPanel.review.revisedAnswer": "Rewrite sample",
  "questionBankPanel.myAnswer.expand": "Write my own answer",
  "questionBankPanel.myAnswer.collapse": "Hide my answer",
  "questionBankPanel.myAnswer.savedHint": "Your answer is saved",
  "questionBankPanel.myAnswer.scoredHint": "last scored {score}",
  "questionBankPanel.myAnswer.placeholder":
    "Answer in your own words: lead with the conclusion, then the approach and trade-offs, then the numbers.",
  "questionBankPanel.myAnswer.submit": "Ask AI to review",
  "questionBankPanel.myAnswer.rescore": "Review again",
  "questionBankPanel.myAnswer.counter": "{count} / {max} characters",
  "questionBankPanel.myAnswer.dirty":
    "Edited since the last review — review again to update the score",
} as const;

export default questionBankPanel;
