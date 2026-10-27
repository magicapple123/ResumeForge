// SPDX-License-Identifier: Apache-2.0
/**
 * The web-form filling page: browser control (address bar and URL history), read/fill
 * feedback, the safety note, the two card titles on the page, and the copy of the three
 * in-page components (pending list, mapping preview table, target-page floating balls).
 *
 * This page only orchestrates (every step card lives under `pages/webform/`), so the copy
 * here is limited to action feedback and card titles; the filling engine keeps its own
 * wording.
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
  "webFormPage.urlBar.confirmDeleteTitle": "Delete this URL from history?",
  "webFormPage.urlBar.deleteAria": "Delete URL {url}",
  "webFormPage.urlBar.placeholder": "Enter the target web form URL to fill (http:// or https://)",
  "webFormPage.urlBar.inputAria": "Web form URL",
  "webFormPage.urlBar.openTooltip":
    "Opens in the dedicated web form browser without replacing the pages you have open",
  "webFormPage.urlBar.open": "Open target page",
  "webFormPage.urlBar.history": "URL history",
  "webFormPage.pending.controlFallback": "Control {index}",
  "webFormPage.pending.empty": "Nothing on this page needs handling by hand",
  "webFormPage.pending.missingTitle": "Not in your profile yet ({count})",
  "webFormPage.pending.goToProfile": "Add it to your profile",
  "webFormPage.pending.blockedTitle": "Do these by hand ({count})",
  "webFormPage.pending.blockedBody":
    "These are never filled automatically: dropdown, radio, checkbox and date values are yours to pick on the page; passwords and verification codes are a deliberate safety boundary; resume attachments, other people's details and confirmations like “I have read and agree” should not be filled by the app either.",
  "webFormPage.pending.unrecognizedTitle": "Not recognized ({count}, expand to view)",
  "webFormPage.pending.unrecognizedBody":
    "Mostly fields inside blocks that allow several rows (internships / projects / awards), plus questions specific to this form (supervisor, lab, research direction). No profile data maps to them yet, so nothing is guessed and written in. Only the rows under Value to fill above are really filled this time.",
  "webFormPage.pending.exitHint":
    "Want to pick a profile entry for a box yourself? Turn on Click-to-fill, go back to the browser and click that box, then choose “Switch profile…” to pick one from the full profile list - even when nothing matches you can expand the whole list.",
  "webFormPage.preview.column.pick": "Fill",
  "webFormPage.preview.column.field": "Field",
  "webFormPage.preview.column.value": "Value to fill",
  "webFormPage.preview.column.status": "Status",
  "webFormPage.preview.status.ready": "Ready",
  "webFormPage.preview.status.readyHint": "The field and the value both matched",
  "webFormPage.preview.status.lowConfidence": "Needs check",
  "webFormPage.preview.status.lowConfidenceHint":
    "Another control also looked like a fit - check that this one is right",
  "webFormPage.preview.status.conflict": "Conflict",
  "webFormPage.preview.status.conflictHint":
    "The page already has a value; it is kept by default so your own input is not overwritten",
  "webFormPage.preview.status.relaxedReady": "Relaxed pick",
  "webFormPage.preview.status.relaxedReadyHint":
    "Relaxed mode: this value comes from clicking, so the app clicks it for you and reads it back - confirm after filling",
  "webFormPage.preview.status.needsConfirm": "Needs consent",
  "webFormPage.preview.status.needsConfirmHint":
    "Consent or declaration checkbox: unchecked by default, clicked for you only after you check it - checking it counts as your own consent",
  "webFormPage.preview.pickAria": "Select {label} to fill",
  "webFormPage.preview.controlLabel": "Page: {label}",
  "webFormPage.preview.currentValue": "On page: {value}",
  "webFormPage.preview.empty": "No field on this page can be filled automatically",
  "webFormPage.floating.groupAria": "Web form click-to-fill switches",
  "webFormPage.floating.collapseAria": "Collapse the web form click-to-fill switches",
  "webFormPage.floating.expandAria": "Expand the web form click-to-fill switches",
  "webFormPage.floating.targetFallback": "Web form page {index}",
  "webFormPage.floating.labelFallback": "Page {index}",
  "webFormPage.floating.switchOff": "Off",
  "webFormPage.floating.toggleAria": "Turn click-to-fill on or off for {name}",
  "webFormPage.floating.more": "{count} more pages",
  "webFormPage.aiAssist.title": "AI assist for unrecognized fields",
  "webFormPage.aiAssist.toggleAria": "AI field recognition assist",
  "webFormPage.aiAssist.body.lead":
    "Fields the rules cannot recognize can be judged by the model you configured in Settings.",
  "webFormPage.aiAssist.body.strong":
    "Only the text and field names already on the page are sent, never your profile content",
  "webFormPage.aiAssist.body.tail":
    "; matched rows are tagged AI suggestion and left unchecked by default.",
  "webFormPage.aiAssist.unavailable":
    "No model is configured yet, so this is unavailable for now. Fill in the Base URL and model name on the Settings page, and boxes the rules cannot recognize can go to the AI.",
  "webFormPage.aiAssist.pendingRestart": "Changes take effect the next time you turn this on",
  "webFormPage.browserCard.isolatedHint":
    "Uses a dedicated browser for web forms; it never covers the apply console or existing web form pages",
  "webFormPage.browserCard.stopTooltip":
    "Close this controlled browser window. Logins inside it are kept, so the next start does not need them again",
  "webFormPage.browserCard.stop": "Close browser",
  "webFormPage.browserCard.startTooltip":
    "Launch this controlled browser window, separate from the browser you use day to day",
  "webFormPage.browserCard.startAria": "Start the dedicated browser",
  "webFormPage.browserCard.start": "Start dedicated browser",
  "webFormPage.browserCard.settingsTooltip":
    "Only changes which browser is used; it never starts or closes it - close and start again for the change to take effect",
  "webFormPage.browserCard.settings": "Browser settings",
  "webFormPage.browserCard.refreshTooltip":
    "Read the running state again. It already refreshes every 0.6 seconds; use this right after closing or starting the window",
  "webFormPage.browserCard.refreshAria": "Refresh status",
  "webFormPage.browserCard.refresh": "Refresh status",
  "webFormPage.browserCard.diagnosticsTooltip":
    "Export diagnostics without resume content, form values or keys - handy to attach together with a screenshot",
  "webFormPage.browserCard.diagnostics": "Export diagnostics",
  "webFormPage.browserCard.endTooltip":
    "End this web form session: the panel is put away and nothing is cleared. Click Read current form to start again",
  "webFormPage.browserCard.end": "End this session",
  "webFormPage.fillRate.label": "Fill rate {percent}% ({filled}/{total})",
  "webFormPage.fillResult.title": "Fill result",
  "webFormPage.fillResult.tag.filled": "Filled {count}",
  "webFormPage.fillResult.tag.unverified": "Needs check {count}",
  "webFormPage.fillResult.tag.failed": "Failed {count}",
  "webFormPage.fillResult.outcome": "Control {index}: {detail}",
  "webFormPage.fillResult.verifyHint":
    "Review the fields in the browser window and click submit yourself once everything is correct",
  "webFormPage.previewCard.title": "Review and fill ({selected} of {total} selected)",
  "webFormPage.previewCard.selectAi": "Select all AI suggestions ({count})",
  "webFormPage.previewCard.fill": "Fill into page",
  "webFormPage.previewCard.empty": "No field can be filled automatically",
  "webFormPage.readSnapshot.step.startBrowser": "Start browser",
  "webFormPage.readSnapshot.step.openPage": "Open web form",
  "webFormPage.readSnapshot.step.reviewMapping": "Review mapping",
  "webFormPage.readSnapshot.step.fill": "Fill",
  "webFormPage.readSnapshot.read": "Read current form",
  "webFormPage.readSnapshot.hint":
    "Open the web form in the browser window first, stop at the step you want to fill, then click here.",
  "webFormPage.readSnapshot.summary": "Read: {title} · {url} · {count} controls",
  "webFormPage.readSnapshot.untitled": "(untitled)",
  "webFormPage.relaxed.onToast": "On: clickable controls will be clicked for you - check each one",
  "webFormPage.relaxed.offToast": "Relaxed mode is off",
  "webFormPage.relaxed.saveFailed": "Could not save the relaxed mode setting",
  "webFormPage.relaxed.title": "Relaxed mode (clicks dropdowns and confirmations for you)",
  "webFormPage.relaxed.toggleAria": "Web form relaxed mode",
  "webFormPage.relaxed.defaultOff":
    "Off by default: the tool fills text boxes only; dropdowns, checkboxes and dates are yours to click.",
  "webFormPage.relaxed.enabledHint":
    "On - clickable controls that match a profile value are clicked and read back for you; consent and declaration items ask you first.",
  "webFormPage.relaxed.risk":
    "When on, the app tries to click dropdown and popup options and to tick the declaration items you confirmed one by one. It can pick the wrong one, so check after filling; date pickers and file uploads are still never done for you.",
  "webFormPage.liveStatus.thinking": "Looking at this box",
  "webFormPage.liveStatus.aiThinking": "AI is recognizing",
  "webFormPage.liveStatus.matched": "Suggestion ready",
  "webFormPage.liveStatus.blocked": "Will not fill automatically",
  "webFormPage.liveStatus.unmatched": "Not recognized",
  "webFormPage.liveStatus.filled": "Filled in",
  "webFormPage.liveStatus.failed": "Could not fill",
  "webFormPage.liveStatus.waiting": "Waiting for you to click a box",
  "webFormPage.error.memoryTargetsFailed": "Could not load the full profile list",
  "webFormPage.toast.restored":
    "Restored the form read last time; the selection is back to default, review before filling",
  "webFormPage.error.restoreFailed": "The form read last time is no longer valid, read it again",
} as const;

export default webFormPage;
