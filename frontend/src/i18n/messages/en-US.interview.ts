// SPDX-License-Identifier: Apache-2.0
/**
 * Mock interview page: session list, Q&A, end/delete confirmations and result toasts. This
 * batch adds the interview-note form modal, the saved-review accordion and the resume
 * improvement suggestions card.
 *
 * `interview.listSeparator` joins list items (focus questions, suggestion evidence) into one
 * line: a full-width semicolon in Chinese and "; " in English - a language-dependent symbol,
 * so it lives in the pack instead of being hard-coded.
 *
 * `interview.confirm.deleteBody` takes the consequence clause through the `{note}` parameter
 * (the shared `HARD_DELETE_NOTE` constant, the single source in
 * `components/common/rowActionMenu.ts`) rather than copying it into the pack.
 */
const interview = {
  "interview.toast.loadFailed": "Could not load interview records",
  "interview.toast.startFailed": "Could not start the interview",
  "interview.toast.openFailed": "Could not open the interview",
  "interview.toast.reportReady": "Interview finished — the score report is ready",
  "interview.toast.submitFailed": "Could not submit the answer — try again",
  "interview.toast.ended": "Interview ended",
  "interview.toast.endFailed": "Could not end the interview",
  "interview.toast.deleted": "Interview deleted",
  "interview.toast.deleteFailed": "Could not delete",
  "interview.toast.deletedMany": "Deleted {count} interviews",
  "interview.toast.deletedPartial": "Deleted {ok}; {failed} failed — try again",
  "interview.toast.savedToMaterials": "Saved to the Interview retrospective category",
  "interview.toast.saveFailed": "Could not save to the material library",
  "interview.toast.questionsImported": "Questions added to Focus areas — review them and start",
  "interview.confirm.endTitle": "End this interview?",
  "interview.confirm.endBody":
    "A score report is generated from the answers so far, and no further answers can be added.",
  "interview.confirm.endOk": "End and get the report",
  "interview.confirm.endCancel": "Keep interviewing",
  "interview.confirm.deleteTitle": "Delete the selected interviews?",
  "interview.confirm.deleteBody": "These {count} interviews will be deleted permanently. {note}",
  "interview.page.title": "Mock interview",
  "interview.page.subtitle":
    "An AI interviewer asks questions at the type and difficulty you set, then gives a score report and improvement suggestions.",
  "interview.action.backToSettings": "Back to settings",
  "interview.tab.interview": "Mock interview",
  "interview.tab.questionBank": "Question bank",
  "interview.tab.experiences": "Interview experiences",
  "interview.tab.review": "Retrospectives",
  "interview.round.withClosing": "Round {current} · the interviewer is wrapping up",
  "interview.round.progress": "Round {current} / {total}",
  "interview.action.end": "End and get the report",
  "interview.action.new": "Start a new one",
  "interview.role.you": "Me",
  "interview.role.comment": "Interviewer feedback:",
  "interview.thinking": "Thinking about the next question…",
  "interview.placeholder":
    "Answer as in a real interview: conclusion first, then what you did and how it turned out (Ctrl+Enter to send)",
  "interview.hint.dontKnow":
    "If you cannot answer, say “I don't know” — the interviewer will suggest an approach.",
  "interview.action.submit": "Submit answer",
  "interview.listSeparator": "; ",

  "interview.experienceForm.title.edit": "Edit interview note",
  "interview.experienceForm.title.create": "New interview note",
  "interview.experienceForm.action.save": "Save interview note",
  "interview.experienceForm.field.title": "Title",
  "interview.experienceForm.placeholder.title": "e.g. Backend interview, round 1",
  "interview.experienceForm.field.company": "Company",
  "interview.experienceForm.placeholder.company": "Company name",
  "interview.experienceForm.field.position": "Role",
  "interview.experienceForm.placeholder.position": "Role name",
  "interview.experienceForm.field.job": "Related job (optional; deleting the job keeps this note)",
  "interview.experienceForm.placeholder.job":
    "Fills in the company and role snapshot once linked (type keywords to search)",
  "interview.experienceForm.field.content": "Body (the interview and how you answered)",
  "interview.experienceForm.placeholder.content": "Note the interview flow and your takeaways",
  "interview.experienceForm.field.questions": "Real questions asked",
  "interview.experienceForm.hint.questions":
    "Press Enter after each one — they are saved to the knowledge base",
  "interview.experienceForm.placeholder.questions": "Type and press Enter",
  "interview.experienceForm.field.tags": "Tags",
  "interview.experienceForm.placeholder.tags": "e.g. client communication, pivot tables",
  "interview.experienceForm.field.source": "Source",
  "interview.experienceForm.field.difficulty": "Difficulty",
  "interview.experienceForm.placeholder.difficulty": "e.g. Medium",
  "interview.experienceForm.field.round": "Round",
  "interview.experienceForm.placeholder.round": "Pick a common round",
  "interview.experienceForm.field.date": "Interview date",

  "interview.reviewHistory.title": "Saved reviews",
  "interview.reviewHistory.fallbackTitle": "Review",
  "interview.reviewHistory.section.questions": "Real questions",
  "interview.reviewHistory.action.detail": "View details",
  "interview.reviewHistory.action.delete": "Delete saved review",
  "interview.reviewHistory.confirm.delete": "Delete this saved review?",
  "interview.reviewHistory.loading": "Loading…",
  "interview.reviewHistory.empty": "No saved reviews yet",

  "interview.suggestions.title": "Resume improvement suggestions",
  "interview.suggestions.empty":
    "No suggestions produced — add more weaknesses or follow-ups the interview exposed",
  "interview.suggestions.evidence": "Evidence: {evidence}",
  "interview.suggestions.goToResume": "Compare and edit in the Resume center →",
} as const;

export default interview;
