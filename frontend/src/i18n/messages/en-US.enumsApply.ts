// SPDX-License-Identifier: Apache-2.0
/**
 * Display names for apply / match protocol values (English pack).
 *
 * One-to-one with `zh-CN.enumsApply.ts`. The values are the localised spelling of the
 * names in `types/apply/*.ts`; the protocol values themselves (`pending`, `allow`,
 * `selector_invalid` …) never change, so the mapping module can keep indexing by them.
 *
 * `browserChoice.chrome.label` / `browserChoice.edge.label` are intentionally absent:
 * those names are brand names spelled identically in every locale and stay sourced from
 * the types table (an equality exception in the guard data would otherwise be required).
 */
const enumsApply = {
  // ===== Queue status (QUEUE_STATUS_META) =====
  "enumsApply.queueStatus.pending": "Pending",
  "enumsApply.queueStatus.skipped": "Skipped",
  "enumsApply.queueStatus.done": "Applied",

  // ===== Batch status (TASK_STATUS_META) =====
  "enumsApply.taskStatus.pending": "Waiting",
  "enumsApply.taskStatus.running": "In progress",
  "enumsApply.taskStatus.paused": "Paused",
  "enumsApply.taskStatus.breaker_paused": "Paused automatically after too many failures in a row",
  "enumsApply.taskStatus.completed": "Completed",
  "enumsApply.taskStatus.stopped": "Stopped",
  "enumsApply.taskStatus.failed": "Failed",

  // ===== Item status inside a batch (TASK_ITEM_STATUS_META) =====
  "enumsApply.taskItemStatus.pending": "Pending",
  "enumsApply.taskItemStatus.running": "In progress",
  "enumsApply.taskItemStatus.success": "Succeeded",
  "enumsApply.taskItemStatus.failed": "Failed",
  "enumsApply.taskItemStatus.skipped": "Skipped",

  // ===== Controlled browser state (BROWSER_STATE_META) =====
  "enumsApply.browserState.stopped": "Not started",
  "enumsApply.browserState.starting": "Starting",
  "enumsApply.browserState.running": "Running",
  "enumsApply.browserState.unknown": "Status unknown",

  // ===== Browser choice (BROWSER_CHOICE_META) =====
  "enumsApply.browserChoice.auto.label": "Automatic (prefers Chrome)",
  "enumsApply.browserChoice.auto.hint":
    "Use Chrome when it is available, and fall back to Edge when it is not.",
  "enumsApply.browserChoice.chrome.hint":
    "Chrome only; if it cannot be found the app says so instead of switching to another browser.",
  "enumsApply.browserChoice.edge.hint":
    "Edge only; if it cannot be found the app says so instead of switching to another browser.",
  "enumsApply.browserChoice.custom.label": "Custom path",
  "enumsApply.browserChoice.custom.hint":
    "Full path to the browser's executable file (the file must exist).",

  // ===== Admission verdicts (ADMISSION_META) =====
  "enumsApply.admission.allow": "Applicable",
  "enumsApply.admission.needs_confirm": "Needs confirmation",
  "enumsApply.admission.block": "Blocked",

  // ===== Match verdicts (MATCH_STATUS_META) =====
  "enumsApply.matchStatus.matched": "Matched",
  "enumsApply.matchStatus.expression_gap": "Wording gap",
  "enumsApply.matchStatus.evidence_insufficient": "Insufficient evidence",
  "enumsApply.matchStatus.real_gap": "Real gap",
  "enumsApply.matchStatus.to_confirm": "Needs confirmation",

  // ===== Five dimensions of the reference score (backend MATCH_SCORE_DIMENSIONS keys) =====
  "enumsApply.matchDimension.skill_coverage": "Skill coverage",
  "enumsApply.matchDimension.experience_years": "Years of experience",
  "enumsApply.matchDimension.project_relevance": "Project relevance",
  "enumsApply.matchDimension.hard_gate": "Hard requirements",
  "enumsApply.matchDimension.jd_keyword_coverage": "JD keyword coverage",

  // ===== Failure categories (FAILURE_CATEGORY_LABELS) =====
  "enumsApply.failure.selector_invalid": "Page structure changed / selector no longer works",
  "enumsApply.failure.login_required": "Sign-in required",
  "enumsApply.failure.captcha_required": "Captcha or security check required",
  "enumsApply.failure.greeting_missing": "Greeting missing",
  "enumsApply.failure.network_timeout": "Network timed out",
  "enumsApply.failure.file_upload_failed": "Resume upload failed",
  "enumsApply.failure.site_unsupported": "This job source does not support auto-apply",
  "enumsApply.failure.profile_insufficient":
    "Profile incomplete — add the missing Resume or web-form details first",
  "enumsApply.failure.unconfirmed": "Could not confirm the result — check it in the browser",
  "enumsApply.failure.unknown": "Unknown failure",

  // ===== Run steps (STEP_LABELS; unknown backend codes still show verbatim) =====
  "enumsApply.step.opening": "Opening the Job page",
  "enumsApply.step.filling": "Filling in the form",
  "enumsApply.step.greeting": "Sending the greeting",
  "enumsApply.step.uploading": "Uploading the Resume",
  "enumsApply.step.submitting": "Submitting the application",
  "enumsApply.step.verifying": "Confirming the result",
  "enumsApply.step.waiting": "Waiting between Jobs",
  "enumsApply.step.idle": "Idle",
} as const;

export default enumsApply;
