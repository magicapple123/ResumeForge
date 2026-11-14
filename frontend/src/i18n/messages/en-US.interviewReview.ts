// SPDX-License-Identifier: Apache-2.0
/**
 * Interview review panel: enter a question, analyze the answer approach, optimize the
 * resume from it, and restore saved reviews.
 *
 * The two "related" placeholders are separate keys on purpose: the job is optional while
 * the resume is required for the reverse optimization, so one shared string would label a
 * required field as optional. The resume select in the saved-review view is the same field
 * as the one in the form, so it reuses `placeholder.resume`.
 *
 * `alert.viewing` keeps the brackets inside the value: the source uses full-width
 * parentheses in Chinese and ASCII ones in English. `{time}` is formatted by the caller.
 */
const interviewReview = {
  "interviewReview.alert.viewing": "Viewing saved review #{id} ({time})",
  /** The saved-review header replaced the old full-width alert: back link + "time · target". */
  "interviewReview.header.back": "Back to saved reviews",
  "interviewReview.header.meta": "{time} · {target}",

  "interviewReview.card.setup": "Interview review",
  "interviewReview.placeholder.question":
    "Enter a question you were actually asked, e.g. how did you solve the hard part of this project?",
  "interviewReview.placeholder.job": "Related job (optional, type keywords to search)",
  "interviewReview.placeholder.resume":
    "Related resume (required for reverse optimization, type keywords to search)",
  /** The dropdown already merges in-app and uploaded resumes; a file can be imported here too. */
  "interviewReview.resume.label": "Resume",
  "interviewReview.resume.hint":
    "The dropdown has two groups: in-app resumes and uploaded external resumes. You can also import a resume file.",
  "interviewReview.action.analyze": "Analyze the answer approach",

  "interviewReview.card.analysis": "Answer approach",
  "interviewReview.section.keyPoints": "Key points",
  /** Weaknesses and follow-ups are editable inputs now, so the labels say what to type. */
  "interviewReview.field.weaknesses": "Weaknesses the interview exposed",
  "interviewReview.field.followUps": "Questions the interviewer kept asking",
  "interviewReview.placeholder.weaknesses":
    "One per line, e.g. could not explain how the metric was calculated; leave it empty if you fill in the follow-ups",
  "interviewReview.placeholder.followUps":
    "One per line, e.g. how exactly is this metric calculated",

  "interviewReview.action.optimize": "Optimize resume from this",
  "interviewReview.action.save": "Save review",
  "interviewReview.optimize.note":
    "Only a suggestion list is produced; the resume text itself is not edited.",
  /** Shown when both inputs are empty, and the reason the button is disabled. */
  "interviewReview.optimize.needInput":
    "Write one thing the interview caught you on, or a question the interviewer kept asking",
  /** The backend caps this at 20 items; the frontend trims and says so before submitting. */
  "interviewReview.optimize.truncated":
    "At most {limit} items are sent; the first {limit} are kept",
  "interviewReview.empty": "Enter a question, then analyze the answer approach",

  "interviewReview.card.legacy": "Saved review",
  "interviewReview.legacy.title": "This is a legacy record and can only be viewed",
  "interviewReview.legacy.body":
    "The legacy record was saved as plain text and cannot be restored into a structured review; only the original content is shown.",

  /** A saved-review row expands to a summary only; the full content lives in the detail view. */
  "interviewReview.history.summary.suggestions": "{count} improvement suggestions",
  "interviewReview.history.summary.empty":
    "This record has no summary content. Open the details to read it.",

  "interviewReview.error.needQuestion": "Enter a question you were actually asked first",
  "interviewReview.error.analyzeFailed": "Could not analyze the answer approach",
  "interviewReview.error.needResume": "Select the resume to optimize first",
  "interviewReview.error.needAnalysis": "Analyze the answer approach first",
  "interviewReview.error.autoSaveFailed": "Could not auto-save the review history",
  "interviewReview.error.notPersisted":
    "Suggestions are ready, but this review has not been saved yet. Save it first, then write back.",
  "interviewReview.error.writeBackFailed":
    "The suggestions were generated but could not be written back to the history",
  "interviewReview.error.optimizeFailed": "Could not optimize the resume",
  "interviewReview.deleted": "Review history deleted",
  "interviewReview.error.deleteFailed": "Could not delete the review history",
} as const;

export default interviewReview;
