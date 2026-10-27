// SPDX-License-Identifier: Apache-2.0
/**
 * "Job requirement analysis" modal: generate / cancel / continue in background, the
 * stale hint, the two requirement and advice sections, and the first-run explanation.
 *
 * The first-run paragraph used `<strong>不会</strong>` for emphasis. It is merged into a
 * single key with the tag dropped (same precedent as zh-CN.datasets.ts): splitting a
 * sentence into before/middle/after breaks English word order, and i18n has no rich-text
 * interpolation.
 */
const jobAnalysis = {
  "jobAnalysis.title": "Job requirement analysis",
  "jobAnalysis.action.start": "Start",
  "jobAnalysis.action.regenerate": "Regenerate",
  "jobAnalysis.action.regenerateAnalysis": "Regenerate analysis",
  "jobAnalysis.action.continueInBackground": "Continue in background",
  "jobAnalysis.aria.cancel": "Cancel generating this analysis",
  "jobAnalysis.toast.cancelled": "Cancelled - the result of this run will not be saved",
  "jobAnalysis.elapsed": "{seconds}s elapsed",
  "jobAnalysis.running.title":
    "You can close this dialog and do something else while it runs; we will remind you when it finishes (dialog + sound).",
  "jobAnalysis.running.body": "Clicking Cancel interrupts this run and its result is not saved.",
  "jobAnalysis.stale.title": "The job details changed, so this analysis may be out of date",
  "jobAnalysis.stale.body": "Generated at {time}; regenerate after rewriting the job description.",
  "jobAnalysis.stale.bodyNoTime": "Regenerate after rewriting the job description.",
  "jobAnalysis.confirm.regenerate.title": "Regenerate the job analysis?",
  "jobAnalysis.confirm.regenerate.body": "This analysis will be replaced by the new result.",
  "jobAnalysis.section.requirements": "Core requirements",
  "jobAnalysis.section.advice": "Job search advice",
  "jobAnalysis.item.evidence": "Evidence: {value}",
  "jobAnalysis.item.rationale": "Why: {value}",
  "jobAnalysis.empty.requirements": "No explicit requirement could be extracted",
  "jobAnalysis.empty.advice": "No additional advice",
  "jobAnalysis.priority.high": "Core requirement",
  "jobAnalysis.priority.medium": "Important requirement",
  "jobAnalysis.priority.low": "Nice to have",
  "jobAnalysis.firstRun.title":
    "This step sends the job description to the model to extract core requirements and job search advice",
  "jobAnalysis.firstRun.body":
    "It reads this job's title, company, description and the tags you saved - it does not send your whole resume or personal profile. It usually takes 10-60 seconds. You can close the dialog while it runs and we will remind you when it finishes.",
} as const;

export default jobAnalysis;
