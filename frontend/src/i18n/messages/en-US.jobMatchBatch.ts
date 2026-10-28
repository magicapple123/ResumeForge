// SPDX-License-Identifier: Apache-2.0
/**
 * The job-square bulk analysis panel: setup, in-progress background task, results and the
 * history view. Two modes share this copy: `match` (per-job verdicts) and `compare`
 * (per-job verdicts followed by a relative ranking with reasons).
 *
 * The history summary has two keys (with and without the top reference score) instead of a
 * main sentence plus a comma-prefixed suffix: a suffix fragment cannot be composed into a
 * grammatical English sentence, and i18n has no "optional fragment" interpolation.
 */
const jobMatchBatch = {
  "jobMatchBatch.title": "Job match analysis",
  "jobMatchBatch.title.compare": "Side-by-side job comparison",
  "jobMatchBatch.action.start": "Start analysis",
  "jobMatchBatch.action.start.compare": "Start comparison",
  "jobMatchBatch.action.restart": "Analyze this batch again",
  "jobMatchBatch.action.viewResult": "View results",
  "jobMatchBatch.action.cancel": "Cancel this analysis",
  "jobMatchBatch.action.background": "Move to background",
  "jobMatchBatch.tab.running": "In progress",
  "jobMatchBatch.tab.result": "This result",
  "jobMatchBatch.tab.setup": "Setup",
  "jobMatchBatch.tab.history": "History",
  "jobMatchBatch.running.title":
    "Analyzing in the background - closing this window does not stop it",
  "jobMatchBatch.running.body":
    "The analysis runs job by job on the server; switching pages does not stop it, and a notification appears when it finishes.",
  "jobMatchBatch.running.progress": "{done} / {total} jobs done",
  "jobMatchBatch.running.failed": " ({count} failed)",
  "jobMatchBatch.running.current": "Analyzing: {title}",
  "jobMatchBatch.running.waiting": "Waiting for the background task to start…",
  "jobMatchBatch.setup.title": "Each of the {count} selected jobs is analyzed one by one",
  "jobMatchBatch.setup.body":
    "The analysis runs in the background, job by job: you can cancel at any time, or close the window and come back later - a notification appears when it finishes. Verdicts carry no percentages; the reference score only orders the list.",
  "jobMatchBatch.setup.title.compare": "{count} selected jobs will be compared side by side",
  "jobMatchBatch.setup.body.compare":
    "Each job is checked first, then the jobs are ranked against each other with reasons, so you can see why one fits you better. The ranking is relative and never shows percentages; the reference score stays display-only. It runs in the background: cancel any time, or close the window and come back later.",
  "jobMatchBatch.setup.force":
    "Re-analyze jobs that already have a verdict (jobs with an existing fit verdict are skipped by default)",
  "jobMatchBatch.setup.selected": "Selected: {count} jobs",
  "jobMatchBatch.history.empty": "No bulk analysis records yet",
  "jobMatchBatch.history.batchTitle": "Batch {id} · {time}",
  "jobMatchBatch.history.summary": "{requested} jobs in total, {completed} done, {failed} failed",
  "jobMatchBatch.history.summaryWithScore":
    "{requested} jobs in total, {completed} done, {failed} failed, top reference score {score}",
  "jobMatchBatch.history.mode.compare": "Comparison",
  "jobMatchBatch.history.mode.match": "Match analysis",
  "jobMatchBatch.detail.title": "Results of batch {id}",
  "jobMatchBatch.detail.loading": "Reading the analysis result…",
  "jobMatchBatch.task.title": "Job match analysis ({count} jobs)",
  "jobMatchBatch.task.title.compare": "Job comparison ({count} jobs)",
  "jobMatchBatch.toast.needJobs": "Select at least one job first",
  "jobMatchBatch.toast.cancelled":
    "Cancelled this analysis; results finished before the cancel are still saved",
  "jobMatchBatch.error.loadHistoryFailed": "Could not read the match records",
  "jobMatchBatch.error.loadResultFailed": "Could not read the analysis result",
  "jobMatchBatch.error.createFailed": "Could not create the analysis task",
  "jobMatchBatch.error.cancelFailed": "Could not cancel",
  "jobMatchBatch.comparison.rank": "Rank {rank}",
  "jobMatchBatch.comparison.verdict.best": "Best fit",
  "jobMatchBatch.comparison.verdict.good": "Good fit",
  "jobMatchBatch.comparison.verdict.fair": "Fair",
  "jobMatchBatch.comparison.verdict.weak": "Weak",
  "jobMatchBatch.comparison.concerns": "Watch out for: {concerns}",
  "jobMatchBatch.comparison.separator": ", ",
  "jobMatchBatch.comparison.disclaimer":
    "The ranking is a relative comparison of this batch's per-job verdicts and never shows percentages; the reference score is still a local rule-based estimate, display only, and does not affect application admission.",
} as const;

export default jobMatchBatch;
