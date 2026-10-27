// SPDX-License-Identifier: Apache-2.0
/**
 * "Job match analysis" dialog: verdicts, admission hints, application advice and actions.
 *
 * This pack supplies the three hard-gate labels (met / not met / unconfirmed) and the
 * three condition group titles; the dialog's status maps store labelKey only. The
 * admission verdict and the five-way status names still come from
 * `types/apply/match.ts`, which the batch result panel shares.
 */
const jobMatch = {
  "jobMatch.empty.none": "No items",
  "jobMatch.error.load": "Could not load the match analysis — try again later",
  "jobMatch.error.analyze": "Could not run the match analysis — try again later",
  "jobMatch.toast.doneTitle": "Match analysis complete",
  "jobMatch.toast.doneInDetail": "Open Match analysis on the Job to see the result.",
  "jobMatch.toast.doneHere": "The result has been updated in this window.",
  "jobMatch.error.title": "Match analysis failed",
  "jobMatch.error.retryHint": " (you can retry from the Job)",
  "jobMatch.toast.cleared": "Cleared this Job's match result",
  "jobMatch.error.clearFailed": "Could not clear",
  "jobMatch.page.title": "Job match analysis",
  "jobMatch.page.subtitle":
    "Judged line by line against your saved Profile and Resumes (unlike Job requirement reading, which only reads the posting)",
  "jobMatch.action.retry": "Retry",
  "jobMatch.hint.background":
    "You can close this window while it runs — a notification and a chime will tell you when it is done, as long as the page is not reloaded.",
  "jobMatch.empty": "This Job has no match analysis yet",
  "jobMatch.intro":
    "The analysis reads your Profile and Resumes and sorts every requirement into one of five verdicts: matched, wording gap, insufficient evidence, real gap, or needs confirmation. Without a configured model it falls back to local rules (everything becomes needs confirmation) rather than pretending an AI comparison happened.",
  "jobMatch.action.start": "Start analysis",
  "jobMatch.field.job": "Job",
  "jobMatch.field.model": "Model",
  "jobMatch.model.local": "Local fallback (no model configured)",
  "jobMatch.field.verdict": "Verdict",
  "jobMatch.field.hardGate": "Hard requirements",
  "jobMatch.warning.gaps":
    "Real gaps found: not auto-applied by default — confirm each one when adding to the apply desk.",
  "jobMatch.warning.unknown":
    "Contains items with insufficient evidence or pending confirmation: confirm each one when adding to the apply desk.",
  "jobMatch.section.advice": "Application advice",
  "jobMatch.section.score": "Reference score",
  "jobMatch.section.scope": "How to read this",
  "jobMatch.action.reanalyze": "Analyse again",
  "jobMatch.action.clear": "Clear result",
  "jobMatch.condition.jdQuote": "From the posting: {quote}",
  "jobMatch.condition.evidence": "Evidence: {evidence}",
  "jobMatch.condition.evidenceMissing": "Not provided in your Profile",
  "jobMatch.group.hardConditions": "Hard requirements",
  "jobMatch.group.coreAbilities": "Core abilities",
  "jobMatch.group.bonusItems": "Bonus items",
  "jobMatch.hardGate.met": "Hard requirements met",
  "jobMatch.hardGate.unmet": "Hard requirements not met",
  "jobMatch.hardGate.unknown": "Hard requirements unconfirmed",
} as const;

export default jobMatch;
