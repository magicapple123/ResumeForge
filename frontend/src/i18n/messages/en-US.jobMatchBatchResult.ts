// SPDX-License-Identifier: Apache-2.0
/**
 * The result layer of the job-square "bulk fit analysis" (`JobMatchBatchResult`):
 * single-job cards, condition lists and the whole-batch result view.
 *
 * Admission verdicts and the five condition statuses still come from
 * `types/apply/match.ts` (shared with the single-job analysis dialog). The separator
 * between note items is pure presentation and travels as `separator.notes`.
 */
const jobMatchBatchResult = {
  "jobMatchBatchResult.group.hardConditions": "Hard requirements",
  "jobMatchBatchResult.group.coreAbilities": "Core abilities",
  "jobMatchBatchResult.group.bonusItems": "Bonus items",

  "jobMatchBatchResult.source.existing": "Reused existing analysis",
  "jobMatchBatchResult.source.local": "Local fallback",
  "jobMatchBatchResult.source.new": "New analysis",

  "jobMatchBatchResult.condition.empty": "No items",
  "jobMatchBatchResult.condition.evidence": "Evidence: {evidence}",

  "jobMatchBatchResult.admission.tag": "Admission: {label}",
  "jobMatchBatchResult.hardGate.field": "Hard requirements: {state}",
  "jobMatchBatchResult.hardGate.met": "Met",
  "jobMatchBatchResult.hardGate.unmet": "Not met",
  "jobMatchBatchResult.hardGate.unknown": "Unconfirmed",

  "jobMatchBatchResult.notes.field": "Notes: {notes}",
  "jobMatchBatchResult.separator.notes": "; ",

  "jobMatchBatchResult.card.rank": "Rank {rank}",
  "jobMatchBatchResult.score.unit": " pts",
  "jobMatchBatchResult.score.label": "Reference score",
  "jobMatchBatchResult.verdict.none": "No verdict yet",
  "jobMatchBatchResult.model.field": "Model: {model}",

  "jobMatchBatchResult.detail.title": "Match details",

  "jobMatchBatchResult.error.itemFailed": "Could not analyze this job",

  "jobMatchBatchResult.summary.title": "{completed} jobs done, {failed} failed",
  "jobMatchBatchResult.summary.description":
    "Results are saved — reopen them any time from History. Jobs are ordered by reference score, highest first.",
  "jobMatchBatchResult.summary.modelUsed": "Model used for this batch: {model}",
  "jobMatchBatchResult.summary.modelMissing":
    "No model was configured for this batch; local fallback results were used.",

  "jobMatchBatchResult.empty.results": "No analysis results to show",
} as const;

export default jobMatchBatchResult;
