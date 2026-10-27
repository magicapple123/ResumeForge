// SPDX-License-Identifier: Apache-2.0
/**
 * Resume suggestions modal: intro card, scanning state, result list.
 *
 * The `instructions` array inside `adopt()` is deliberately absent: those lines are a
 * **model prompt** sent to `reviseResume()`, not UI copy, and translating them would
 * change what the model does. The evidence line in the result list *is* copy, so it
 * lives here; the separator between evidence items travels as `separator.evidence`.
 */
const resumeSuggestions = {
  "resumeSuggestions.modal.title": "Suggestions for this job",

  "resumeSuggestions.priority.high": "Fix first",
  "resumeSuggestions.priority.medium": "Recommended",
  "resumeSuggestions.priority.low": "Optional polish",

  "resumeSuggestions.adopted": "Suggestion applied and the resume updated",
  "resumeSuggestions.adoptFailed": "Could not apply the suggestion. Try again later",
  "resumeSuggestions.generateFailed": "Could not generate suggestions. Try again later",

  "resumeSuggestions.intro.title": "Generate suggestions for this job",
  "resumeSuggestions.intro.body":
    "Reads this resume and the job description of the linked job, then makes one model call to produce a suggestion list. It takes about 10–60 seconds; you can close the window while it runs and you will be notified when it finishes.",
  "resumeSuggestions.action.start": "Start generating",

  "resumeSuggestions.scanning.elapsed": "Generating suggestions… {seconds}s elapsed",
  "resumeSuggestions.scanning.hint": "You can close this window; generation continues",
  "resumeSuggestions.action.cancelScan": "Cancel generation",

  "resumeSuggestions.target.company": "Target role: {company} · {job}",
  "resumeSuggestions.target.job": "Target role: {job}",

  "resumeSuggestions.regenerate.confirm": "Regenerating replaces the current suggestions",
  "resumeSuggestions.regenerate.ok": "Regenerate",
  "resumeSuggestions.action.regenerate": "Regenerate suggestions",

  "resumeSuggestions.action.adopt": "Apply and edit",

  "resumeSuggestions.evidence": "Evidence: {evidence}",
  "resumeSuggestions.separator.evidence": "; ",

  "resumeSuggestions.empty":
    "This resume already matches the job requirements well; nothing has to change",
} as const;

export default resumeSuggestions;
