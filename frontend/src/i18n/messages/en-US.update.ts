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
  "update.inApp.checking": "Checking for updates",
  "update.inApp.noTranslation": "This release has no notes in English.",
  "update.inApp.downloading": "Downloading the installer",
  "update.inApp.verifying": "Verifying the installer",
  "update.inApp.installing": "Restarting to install",
  "update.inApp.viewProgress": "View update progress",
  "update.inApp.restartHint":
    "After verification, the app installs the update and restarts. Your resumes, jobs and settings are kept.",
  "update.inApp.incomplete": "Release files are still being published. Check again later.",
  "update.inApp.stalled": "The download stalled. Check your connection and try again.",
  "update.inApp.interrupted": "The last update did not finish. Check again to retry.",
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
  // Deliberately distinct from "Not provided": that means upstream omitted the
  // field, this means the check itself did not reach an answer. A desktop shell
  // checks over its own network stack and may already have shown 2.3.0, so the
  // settings card must not claim the information simply does not exist.
  "update.value.unconfirmed": "Not confirmed this time",
  "update.result.unconfirmed": "This check could not confirm the version",
  "update.desktop.preferShell":
    "The desktop app runs its own update check; trust the dialog it shows.",
  "update.desktop.checkFailed": "The desktop app could not confirm whether a new version exists.",
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
    "Use Help → Check for updates in the menu. Windows also has update.cmd in the install folder.",
  "update.desktop.releaseHint":
    "The release page has packages for each platform. Choose the matching one to install manually.",
  "update.action.recheckIn": "Check again ({seconds}s)",
  "update.toast.desktopStarted": "Checking in the desktop app; the result will appear in a dialog",

  // ── Startup update prompt (UP-01) ────────────────────────────
  "update.startup.title": "Version {version} is available",
  "update.startup.current": "Current",
  "update.startup.latest": "Latest",
  "update.startup.size": "Download size",
  "update.startup.notes": "What's new",
  "update.startup.expand": "Show all",
  "update.startup.collapse": "Show less",
  "update.startup.noNotes": "This release has no notes.",
  "update.startup.updateNow": "Update now",
  "update.startup.later": "Later",
  "update.startup.laterHint": "Don't remind me for 24 hours",
  "update.startup.skip": "Skip this version",
  "update.startup.skipHint": "Don't remind me about this version",
  "update.startup.hide": "Hide",
  "update.startup.ready": "Downloaded and verified (SHA-256)",
  "update.startup.readyHint":
    "Restarting replaces program files only. Jobs, resumes, chats and settings in data/ are kept.",
  "update.startup.install": "Restart and install",
  "update.startup.openUpdater": "Update in app",
  "update.startup.scrollHint": "More below — scroll to see the rest",
  "update.startup.downloadPackage": "Download installer",
  "update.startup.release": "Open release page",
  "update.startup.unsupported":
    "In-app installation isn't available on this platform. Download the installer and update manually.",
} as const;

export default update;
