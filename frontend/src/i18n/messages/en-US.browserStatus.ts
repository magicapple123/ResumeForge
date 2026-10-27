// SPDX-License-Identifier: Apache-2.0
/**
 * The apply-only browser status bar: start / open job site / stop / refresh, plus the two
 * explanation paragraphs.
 *
 * Both paragraphs used inline `<Typography.Text strong>` emphasis. They are merged into a
 * single key each with the tag dropped (same precedent as zh-CN.datasets.ts): splitting a
 * sentence into before/strong/after breaks English word order, and i18n has no rich-text
 * interpolation.
 *
 * The polling interval is a display number and travels as `{seconds}`; "refreshing" and
 * "idle" are two different wordings.
 */
const browserStatus = {
  "browserStatus.title": "Apply-only browser",
  "browserStatus.port": "Debug port {port}",
  "browserStatus.action.start": "Start browser",
  "browserStatus.action.openSite": "Open job site",
  "browserStatus.action.stop": "Close browser",
  "browserStatus.action.reload": "Refresh status",
  "browserStatus.aria.reload": "Refresh status",
  "browserStatus.tooltip.openSite": "Reopen the job site home page in this window",
  "browserStatus.tooltip.openSiteDisabled":
    "Available once the browser is running; use it to get the login page back if the tab was closed or navigated away",
  "browserStatus.tooltip.reload": "Refreshing; otherwise it checks about every {seconds} seconds",
  "browserStatus.tooltip.reloadIdle": "Checks about every {seconds} seconds; click to check now",
  "browserStatus.intro":
    "Applying and collection both happen in this separate window (it uses its own data directory, so your everyday browser is unaffected). After you click Start browser it opens the job site home page directly - scan the QR code there once. You log in yourself: the app never stores passwords, cookies or verification codes, and the login is kept by the browser, so there is no need to log in again next time. If you close the tab or navigate away, click Open job site to get it back without restarting the browser.",
  "browserStatus.adopted":
    "This window was opened by the previous run; the app lost its process handle when it restarted, so it cannot close it - the app only closes windows it started itself and never guesses by process ID (that would risk closing your own browser). Close that window yourself; collection and applying are unaffected.",
  "browserStatus.entry": "Site entry: {url}",
  "browserStatus.browser": "Browser in use:",
  "browserStatus.browserWithName": "{name} ({path})",
  "browserStatus.toast.started":
    "The apply-only browser started - scan the QR code in the window that popped up",
  "browserStatus.toast.siteOpened": "Opened the job site in that window - scan the QR code there",
  "browserStatus.toast.stopped": "Closed the apply-only browser",
  "browserStatus.error.startFailed": "Could not start the apply-only browser",
  "browserStatus.error.openSiteFailed": "Could not open the job site",
  "browserStatus.error.stopFailed": "Could not close the apply-only browser",
} as const;

export default browserStatus;
