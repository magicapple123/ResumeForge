// SPDX-License-Identifier: Apache-2.0
/**
 * The create / edit form for a progress record: field labels, required messages, the
 * status and channel dropdowns, and the date hints.
 *
 * Status and channel values are protocol codes (English, see `types/tracker.ts`, matching
 * the backend verbatim); this file only owns their display names through two
 * `Record<…, MessageKey>` tables resolved with `t()`. `types/tracker.ts` is untouched.
 * `offer` happens to be spelled the same in both languages (Chinese recruiting says
 * "Offer" too), and is registered as a locale-independent word in
 * `guards/equalityExemptions.ts`.
 */
const trackerForm = {
  "trackerForm.title.create": "Add progress",
  "trackerForm.title.edit": "Edit progress",
  "trackerForm.action.save": "Save progress",
  "trackerForm.field.company": "Company",
  "trackerForm.field.title": "Job",
  "trackerForm.field.status": "Current status",
  "trackerForm.field.stageNote": "Stage",
  "trackerForm.field.appliedAt": "Applied on",
  "trackerForm.field.statusDate": "Status updated on",
  "trackerForm.field.nextAction": "Next step",
  "trackerForm.field.nextActionDate": "Due date",
  "trackerForm.field.channel": "Channel",
  "trackerForm.field.job": "Linked job",
  "trackerForm.field.resume": "Resume used",
  "trackerForm.field.note": "Note",
  "trackerForm.required.company": "Enter the company name",
  "trackerForm.required.title": "Enter the job title",
  "trackerForm.placeholder.company": "e.g. Example Tech",
  "trackerForm.placeholder.title": "e.g. Backend development intern",
  "trackerForm.placeholder.nextAction": "e.g. Confirm the interview time",
  "trackerForm.placeholder.job": "Pick the job to link (type keywords to search)",
  "trackerForm.placeholder.resume":
    "Pick the resume version used for this application (type to search)",
  "trackerForm.hint.stageNote": 'Which round and in what form, e.g. "second round", "HR round"',
  "trackerForm.hint.appliedAt":
    "Leave it empty if the date is unknown - the record then stays out of the application trend and weekday charts.",
  "trackerForm.action.fillToday": "Fill in today",
  "trackerForm.hint.statusDate": "The date written on the notification",
  "trackerForm.hint.nextActionDate": "Shown in red once overdue",
  "trackerForm.hint.channel":
    "Optional. This is where you applied from, not how the record got into the app; keep Unknown if unsure",
  "trackerForm.hint.job": "Optional. Once linked, this progress shows on the job details page",
  "trackerForm.hint.resume":
    "Optional. Linking keeps a snapshot of the application on the resume details page; editing the resume afterwards does not change the saved record",
  "trackerForm.status.applied": "Applied",
  "trackerForm.status.screening": "Screening",
  "trackerForm.status.assessment": "Assessment / test",
  "trackerForm.status.interview": "Interview",
  "trackerForm.status.offer": "Offer",
  "trackerForm.status.rejected": "Closed",
  "trackerForm.status.unknown": "To confirm",
  "trackerForm.channel.unknown": "Unknown",
  "trackerForm.channel.referral": "Referral",
  "trackerForm.channel.official_website": "Company website",
  "trackerForm.channel.job_platform": "Job platform",
  "trackerForm.channel.headhunter": "Headhunter / agency",
  "trackerForm.channel.other": "Other",
  "trackerForm.toast.saved": "Saved",
  "trackerForm.toast.added": "Added",
  "trackerForm.error.saveFailed": "Could not save",
} as const;

export default trackerForm;
