// SPDX-License-Identifier: Apache-2.0
/**
 * Delivery receipt (T09): the three-state badge, stable-code display names, section
 * labels and the acknowledgement action. The state and its priority are decided by
 * the backend; this pack only holds display names.
 */
const deliveryReceipt = {
  "deliveryReceipt.title": "Delivery receipt",
  "deliveryReceipt.state.waiting_human": "Waiting for you",
  "deliveryReceipt.state.has_doubts": "Has doubts",
  "deliveryReceipt.state.ready": "Ready to check",
  "deliveryReceipt.stateUnknown": "Unrecognized state",
  "deliveryReceipt.reason.captcha_required": "CAPTCHA needs a human",
  "deliveryReceipt.reason.login_required": "Sign in to continue",
  "deliveryReceipt.reason.reupload_resume": "Upload the resume again",
  "deliveryReceipt.reason.answer_screening_questions": "Answer screening questions",
  "deliveryReceipt.reason.fill_required_field": "A required field was not filled",
  "deliveryReceipt.reason.confirm_in_browser": "Confirm in the browser",
  "deliveryReceipt.reason.doubts_present": "The fact ledger has doubts",
  "deliveryReceipt.reason.snapshot_missing": "No delivery snapshot",
  "deliveryReceipt.reason.artifact_missing": "Export snapshot has no artifact",
  "deliveryReceipt.reason.page_limit": "More pages than the target",
  "deliveryReceipt.field.notRecorded": "Not recorded",
  "deliveryReceipt.section.delivery": "Which version was sent",
  "deliveryReceipt.section.fill": "Which fields were filled",
  "deliveryReceipt.section.doubts": "Fact ledger doubts",
  "deliveryReceipt.section.humanSteps": "What is left before submission",
  "deliveryReceipt.section.followup": "Follow-up plan",
  "deliveryReceipt.field.job": "Sent to",
  "deliveryReceipt.field.resume": "Resume version",
  "deliveryReceipt.field.pages": "Exported pages",
  "deliveryReceipt.field.pagesValue": "{pages} pages (limit {limit})",
  "deliveryReceipt.field.format": "Export format",
  "deliveryReceipt.field.createdAt": "Sent at",
  "deliveryReceipt.field.resumeChanged": "Resume changed after sending",
  "deliveryReceipt.field.requestParams": "Request parameters",
  "deliveryReceipt.fill.matched": "Matched a web-form fill record",
  "deliveryReceipt.fill.unknown": "No matching web-form record (possibly a one-click apply)",
  "deliveryReceipt.fill.count": "Filled {filled}/{total} fields",
  "deliveryReceipt.fill.failed": "{count} fields failed",
  "deliveryReceipt.doubts.count": "{count} doubts",
  "deliveryReceipt.humanSteps.none": "No manual steps",
  "deliveryReceipt.followup.due": "Follow-up reminder: {date}",
  "deliveryReceipt.followup.none": "No follow-up reminder yet",
  "deliveryReceipt.ack.action": "Confirm I checked this receipt",
  "deliveryReceipt.ack.done": "Acknowledged",
  "deliveryReceipt.ack.hint":
    "Acknowledging only records that you looked; it does not change the stage in your job tracker.",
  "deliveryReceipt.ack.toast": "This delivery receipt is acknowledged",
  "deliveryReceipt.ack.error": "The receipt was not acknowledged. Try again.",
  "deliveryReceipt.empty.snapshot":
    "This record has no delivery snapshot; that is normal for historical records or deliveries sent before snapshots were frozen.",
  "deliveryReceipt.error.load": "The delivery receipt could not be loaded. Try again.",
} as const;

export default deliveryReceipt;
