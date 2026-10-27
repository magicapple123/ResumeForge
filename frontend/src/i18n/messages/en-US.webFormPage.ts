// SPDX-License-Identifier: Apache-2.0
/**
 * The web-form filling page: browser control, read/fill feedback, the safety note and the
 * two card titles on the page.
 *
 * This page only orchestrates (every step card lives under `pages/webform/`), so the copy
 * here is limited to action feedback and card titles; the filling engine and the preview
 * details own their own wording.
 */
const webFormPage = {
  "webFormPage.notice.title":
    "This feature only fills your data into the page; it never submits for you",
  "webFormPage.notice.body":
    "After filling, review each field in the browser window and click the page's own submit button yourself once everything is correct.",
  "webFormPage.hint.expandLater":
    "Once the browser is ready, the safety note, AI assist and relaxed-mode controls expand here step by step.",
  "webFormPage.card.pending": "This page also asks for",
  "webFormPage.card.records": "Fill records",
  "webFormPage.toast.targetOpened":
    "The target web form is open; existing pages are left untouched",
  "webFormPage.toast.browserStarted":
    "The browser started. Open the company's web form in that window, then come back and click Read current form",
  "webFormPage.toast.sessionEnded": "This web form session has ended",
  "webFormPage.toast.statusRefreshed": "Browser status refreshed",
  "webFormPage.toast.diagnosticsExported":
    "Exported the redacted diagnostics - attach it together with screenshots",
  "webFormPage.toast.liveOn":
    "On. Go back to the browser window: click any box and the value to fill appears next to it",
  "webFormPage.toast.liveOff":
    "Off. The floating ball stays grey and the page no longer shows suggestion cards",
  "webFormPage.toast.nothingToFill":
    "No field on this page could be filled automatically - check the list below",
  "webFormPage.toast.filled":
    "Filled {count} fields - review them in the browser window and submit yourself",
  "webFormPage.toast.remembered":
    "Saved {count} items; the same box is filled automatically next time",
  "webFormPage.toast.memorySaved":
    "Saved to the profile targets you picked; you can reuse them next time",
  "webFormPage.error.startFailed": "Could not start the browser",
  "webFormPage.error.openUrlFailed": "Could not open the web form page",
  "webFormPage.error.deleteHistoryFailed": "Could not delete the URL record",
  "webFormPage.error.stopFailed": "Could not close the browser",
  "webFormPage.error.endFailed": "Could not end this session",
  "webFormPage.error.refreshFailed": "Could not refresh the browser status",
  "webFormPage.error.diagnosticsFailed": "Could not export the diagnostics",
  "webFormPage.error.liveToggleFailed": "Could not toggle click-to-fill",
  "webFormPage.error.readFailed": "Could not read the form",
  "webFormPage.error.fillFailed": "Fill failed",
  "webFormPage.error.rememberFailed": "Could not save, try again later",
  "webFormPage.error.memorySaveFailed": "Could not save the profile, try again later",
} as const;

export default webFormPage;
