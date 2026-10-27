// SPDX-License-Identifier: Apache-2.0
/**
 * Job tracker enumerations: progress status, record source, application channel and merge
 * verdict.
 *
 * Keys are protocol values (see `types/tracker.ts`, matching `models/tracker.py`); the page
 * layer resolves them through `i18n/enum/tracker.ts`. `offer` is not repeated here: its
 * Chinese source value is already the English word "Offer", so the display name keeps the
 * registered locale-independent `trackerForm.status.offer` entry instead of a second synonym.
 */
const enumsTracker = {
  "enumsTracker.status.applied": "Applied",
  "enumsTracker.status.screening": "Screening",
  "enumsTracker.status.assessment": "Assessment / test",
  "enumsTracker.status.interview": "Interview",
  "enumsTracker.status.rejected": "Closed",
  "enumsTracker.status.unknown": "To confirm",

  "enumsTracker.source.apply": "Auto-logged from the apply console",
  "enumsTracker.source.manual": "Added manually",
  "enumsTracker.source.recognized": "Imported from messages",

  "enumsTracker.channel.unknown": "Unknown",
  "enumsTracker.channel.referral": "Referral",
  "enumsTracker.channel.official_website": "Company website",
  "enumsTracker.channel.job_platform": "Job platform",
  "enumsTracker.channel.headhunter": "Headhunter / agency",
  "enumsTracker.channel.other": "Other",

  "enumsTracker.mergeAction.created": "New record",
  "enumsTracker.mergeAction.updated": "Progress updated",
  "enumsTracker.mergeAction.unchanged": "Already up to date",
} as const;

export default enumsTracker;
