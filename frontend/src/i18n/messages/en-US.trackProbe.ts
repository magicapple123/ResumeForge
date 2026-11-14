// SPDX-License-Identifier: Apache-2.0
/** Application status read-back (R-15 C) copy. */
export default {
  "trackProbe.action": "Refresh status",
  "trackProbe.running": "Checking {done}/{total}",
  "trackProbe.manualHint":
    "Read the application status from the job page or the candidate portal. Nothing changes without clear evidence.",
  "trackProbe.auto": "Daily check",
  "trackProbe.autoHint":
    "When you open this page, check once if {hours} hours have passed since the last read-back.",
  "trackProbe.autoOn": "Daily read-back enabled",
  "trackProbe.autoOff": "Daily read-back disabled",
  "trackProbe.done": "Done: {count} record(s) updated",
  "trackProbe.noChange": "Done: nothing changed",
  "trackProbe.failed": "Read-back failed, please try again later",
  "trackProbe.failedHint":
    "{count} page(s) could not be fetched: the portal likely requires sign-in.",
  "trackProbe.empty": "No active records to check",
  "trackProbe.partial": "Up to 48 records per run; {rest} left for next time.",
  "trackProbe.dailyChanged": "Daily read-back: {count} record(s) updated",
  "trackProbe.resultTitle": "Read-back results",
  "trackProbe.outcome.changed": "Updated",
  "trackProbe.outcome.unchanged": "No change",
  "trackProbe.outcome.skipped": "Skipped",
  "trackProbe.outcome.failed": "Failed",
  "trackProbe.settingsTitle": "Read-back settings",
  "trackProbe.pageUrl": "Applications page",
  "trackProbe.pageUrlExample": "https://acme.jobs.feishu.cn/.../applications",
  "trackProbe.cookieExample": "session=...; other=...",
  "trackProbe.pageUrlHint":
    "Paste the URL of your applications page (optional). When set, one refresh reads that page first and covers every company at once; records not found there are read one by one from their job pages.",
  "trackProbe.cookieTitle": "Candidate portal sign-in cookie",
  "trackProbe.cookieHint":
    "Statuses such as screening or interview are only visible after signing in. Sign in to the portal, copy the Cookie request header from your browser devtools and paste it below. It is stored in the local database only.",
  "trackProbe.cookieSave": "Save and continue",
  "trackProbe.cookieSkip": "Try the public page first",
  "trackProbe.cookieAction": "Add a cookie to read detailed stages",
};
