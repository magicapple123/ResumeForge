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
  "jobMatch.action.reanalyze": "Analyze again",
  "jobMatch.action.clear": "Clear result",
  "jobMatch.condition.jdQuote": "From the posting: {quote}",
  "jobMatch.condition.evidence": "Evidence: {evidence}",
  "jobMatch.condition.evidenceMissing": "Not provided in your Profile",
  "jobMatch.group.hardConditions": "Hard requirements",
  "jobMatch.group.coreAbilities": "Core abilities",
  "jobMatch.group.bonusItems": "Bonus items",
  "jobMatch.task.label": "Analyzing “{job}”",
  "jobMatch.hint.starting": "Starting the analysis...",
  "jobMatch.hint.progress": "Comparing requirement by requirement... ({percent}%)",
  "jobMatch.action.cancel": "Cancel analysis",
  "jobMatch.error.cancelFailed": "Could not cancel - try again later",
  "jobMatch.hardGate.met": "Hard requirements met",
  "jobMatch.hardGate.unmet": "Hard requirements not met",
  "jobMatch.hardGate.unknown": "Hard requirements unconfirmed",
  "jobMatch.resume.label": "Resume for matching",
  "jobMatch.resume.default": "Default resume for each job",
  "jobMatch.resume.loadError": "Could not load resumes; retry",
  "jobMatch.resume.retry": "Reload resumes",
  "jobMatch.resume.source": "Analyzed resume: {title} · revision {revision}",
  "jobMatch.resume.profileOnly": "Analysis source: My profile",
  "jobMatch.resume.unknownSource": "Resume source unavailable for this older result",
  "jobMatch.resume.stale": "Resume or job changed; analyze again",
  "jobMatch.textLevel.title": "Text-level match (external resume)",
  "jobMatch.textLevel.badge": "Text-level",
  "jobMatch.textLevel.intro":
    "Only JD keywords vs this resume's text: no structured fields, no eligibility call. A different basis from the structured match above.",
  "jobMatch.textLevel.resume.label": "Which external resume",
  "jobMatch.textLevel.resume.placeholder": "Pick an external resume that has text",
  "jobMatch.textLevel.resume.noText": "(no text)",
  "jobMatch.textLevel.resume.noTextHint":
    "No text was extracted from this file (likely a scan), so it cannot be compared: run a text check or add the text in the resume center first",
  "jobMatch.textLevel.resume.someNoText":
    "The greyed-out resumes have no extracted text (usually scans), so they cannot be compared: run a text check or add the text in the resume center, then pick one.",
  "jobMatch.textLevel.resume.empty":
    "No external resume is available for comparison yet. Scans and files without a text layer have no body text - run a text check or add the text in the resume center first.",
  "jobMatch.textLevel.error.resumes": "Could not load external resumes; retry",
  "jobMatch.textLevel.error.run": "Text-level comparison failed; try again later",
  "jobMatch.textLevel.coverage": "Literal coverage",
  "jobMatch.textLevel.coverageValue": "{matched} / {target} words",
  "jobMatch.textLevel.resumeSource": "Source: {name} · {chars} characters",
  "jobMatch.textLevel.matched": "Found in the text",
  "jobMatch.textLevel.missing": "Not mentioned in the text",
  "jobMatch.textLevel.highlights": "Quoted from the text",
  "jobMatch.textLevel.highlightWords": "(matches: {words})",
  "jobMatch.textLevel.empty.words":
    "No comparable words could be pulled from this job description (too short, or only generic phrasing).",
} as const;

export default jobMatch;
