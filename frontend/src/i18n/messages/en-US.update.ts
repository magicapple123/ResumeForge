// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的软件更新卡片：检查、下载、重启安装与结果提示。
 *
 * 带 `<code>` 内嵌的说明段落不在本文件——片段拼接在英文里语序不通，
 * 需要单独设计成整段 key（与投递队列页同一处理）。
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
  "update.result.latest": "Latest version: {version}",
  "update.result.published": "Published: {date}",
} as const;

export default update;
