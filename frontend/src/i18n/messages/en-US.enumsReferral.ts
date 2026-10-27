// SPDX-License-Identifier: Apache-2.0
/**
 * Referral and reminder enum labels: referral status, reminder kind, reminder status and
 * reminder urgency.
 *
 * Keys are protocol values (see `types/referral.ts` and `types/reminder.ts`, matched word
 * for word by the backend); the page layer resolves them through `i18n/enum/referral.ts`
 * and `i18n/enum/reminder.ts`.
 */
const enumsReferral = {
  // ===== Referral status (display names for REFERRAL_STATUS_LABELS) =====
  "enumsReferral.referralStatus.active": "Contacted",
  "enumsReferral.referralStatus.submitted": "Submitted",
  "enumsReferral.referralStatus.closed": "Closed",
  "enumsReferral.referralStatus.invalid": "Invalid",

  // ===== Reminder kind (display names for REMINDER_KIND_LABELS) =====
  "enumsReferral.reminderKind.interview": "Interview",
  "enumsReferral.reminderKind.assessmentDeadline": "Assessment / test deadline",
  "enumsReferral.reminderKind.hrReply": "Chase HR for a reply",
  "enumsReferral.reminderKind.other": "Other",

  // ===== Reminder status (display names for REMINDER_STATUS_LABELS) =====
  "enumsReferral.reminderStatus.pending": "To do",
  "enumsReferral.reminderStatus.done": "Done",
  "enumsReferral.reminderStatus.dismissed": "Dismissed",

  // ===== Reminder urgency (display names for REMINDER_URGENCY_LABELS) =====
  "enumsReferral.reminderUrgency.overdue": "Overdue",
  "enumsReferral.reminderUrgency.soon": "Due soon",
  "enumsReferral.reminderUrgency.upcoming": "Coming up",
  "enumsReferral.reminderUrgency.later": "Later",
} as const;

export default enumsReferral;
