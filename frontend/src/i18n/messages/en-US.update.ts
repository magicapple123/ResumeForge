// SPDX-License-Identifier: Apache-2.0
/**
 * Settings · software update card: checking, downloading, restart-and-install and results.
 *
 * Paragraphs with an inline `<code>` are split into lead / middle / tail keys. The
 * paragraphs still read as one sentence; the spaces around `<code>` live in JSX
 * `{" "}` rather than inside a translation, because spacing rules differ by language.
 */
const update = {
  "update.size.unknown": "Unknown size",
  "update.toast.doneTitle": "ResumeForge updated",
  "update.toast.doneBody":
    "Updated to {version}. Your Jobs, Resumes and settings stay in the original data directory.",
  "update.toast.failedTitle": "The last update failed",
  "update.toast.interruptedTitle": "The last update did not finish",
  "update.error.check": "Could not check for updates",
  "update.error.download": "Could not download the update",
  "update.error.install": "Could not start the installer",
  "update.confirm.title": "Restart and install the update?",
  "update.confirm.body":
    "The app quits first, replaces the program files and restarts automatically. Jobs, Resumes, conversations and settings live in data/ and are never overwritten by the update package.",
  "update.confirm.ok": "Restart and install",
  "update.confirm.cancel": "Install later",
  "update.card.title": "Software update",
  "update.field.channel": "Update channel",
  "update.side.title": "Version info",
  "update.field.latest": "Latest version",
  "update.side.note": "Updates replace program files only; data under data/ is untouched.",
  "update.field.current": "Current version",
  "update.field.target": "Target version",
  "update.value.checkFirst": "Check for updates to fill this in",
  "update.action.check": "Check for updates",
  "update.action.download": "Download update",
  "update.action.recheck": "Check again",
  "update.action.install": "Restart and install",
  "update.bgDownload": "Download in the background (remind me to install when done)",
  "update.action.retryStatus": "Retry reading the status",
  "update.installing.title":
    "The updater has started; the app will quit and restart automatically.",
  "update.hint.restart":
    "After Restart and install, the app overwrites the old version in place and restarts.",
  "update.action.release": "Open the release page",
  "update.result.title": "Check complete",
  "update.result.available": "Update available: {version}",
  "update.result.uptodate": "You are on the latest version",
  "update.field.published": "Published",
  "update.value.noDate": "Not provided",
  "update.notes.title": "What's new",
  "update.notes.expand": "Show",
  "update.notes.collapse": "Hide",
  "update.installResult.noReason": "The updater did not give a reason.",
  "update.installResult.lead": "The app still works and your data was not changed. The log is at",
  "update.installResult.middle": ", or double-click",
  "update.installResult.tail": "to run the update again.",
  "update.intro.filesOnly":
    "An update only replaces the program files. Your Jobs, Resumes, assistant conversations and settings in",
  "update.intro.dataSuffix": "are never overwritten.",
  "update.intro.backupHint":
    "Before updating, it is still worth exporting a backup in Datasets and backups.",
  "update.downloading": "Downloading the update package: {downloaded} / {total}",

  // Desktop shape: the shell owns its own upgrade channel (desktop/updater.js), so the
  // card explains who checks and where the two manual entry points are. The heading and
  // the first paragraph are `update.desktop.title` / `update.desktop.description` in
  // en-US.core.ts (existing keys, reworded in place).
  "update.desktop.manual":
    "To check manually, use Help → Check for updates in the menu, or double-click update.cmd in the install folder.",
  "update.desktop.releaseHint":
    "You can also download Setup.exe from the release page and install it manually.",
  "update.action.recheckIn": "Check again ({seconds}s)",
  "update.toast.desktopStarted": "Checking in the desktop app; the result will appear in a dialog",
} as const;

export default update;
