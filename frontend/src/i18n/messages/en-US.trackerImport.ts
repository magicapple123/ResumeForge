// SPDX-License-Identifier: Apache-2.0
/**
 * The "import progress from a notification" dialog on the Tracker page: paste or
 * screenshot input, the recognition preview, and the write-back result.
 *
 * Status names reuse `trackerForm.status.*` - one protocol value must keep one name in
 * every place it is shown. The merge verdicts only appear in this preview, so they live
 * here. `types/tracker.ts` is untouched; TrackCard and AnalyticsPage still read its
 * status label table.
 */
const trackerImport = {
  "trackerImport.dialog.title": "Import progress from notifications",
  "trackerImport.dialog.intro":
    'Paste a recruiting email, text message or in-app notification here (screenshots work too). The preview shows "what will happen" before you confirm - nothing is written until then.',
  "trackerImport.dialog.placeholder":
    "Press Ctrl+V here to paste a screenshot; plain-text notifications can be pasted directly.",
  "trackerImport.action.recognize": "Recognize and preview",
  "trackerImport.action.confirm": "Save the {count} selected records",
  "trackerImport.engine.ai": "AI recognition",
  "trackerImport.engine.local": "Local keyword match",
  "trackerImport.empty.noResults": "No recognition results yet",
  "trackerImport.evidence.label": "Evidence: {evidence}",
  "trackerImport.toast.noInput": "Paste the notification first, or upload a screenshot or document",
  "trackerImport.toast.noRecords": "No usable progress records found",
  "trackerImport.toast.recognizeFailed": "Could not recognize the content",
  "trackerImport.toast.noneSelected": "Select at least one record",
  "trackerImport.toast.saveFailed": "Could not save",
  "trackerImport.result.created": "{count} added",
  "trackerImport.result.updated": "{count} updated",
  "trackerImport.result.unchanged": "{count} already up to date",
  "trackerImport.result.separator": ", ",
  "trackerImport.result.done": "Done",
  "trackerImport.mergeAction.created": "New record",
  "trackerImport.mergeAction.updated": "Progress updated",
  "trackerImport.mergeAction.unchanged": "Already up to date",
} as const;

export default trackerImport;
