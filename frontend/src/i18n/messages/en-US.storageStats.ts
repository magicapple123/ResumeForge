// SPDX-License-Identifier: Apache-2.0
/**
 * Settings · storage card: per-folder disk usage, the cleanup preview and its result dialog.
 *
 * `{hint}` (the "the 3 most recent backups never appear in the list" sentence) is a
 * parameter of the surrounding sentence, not concatenated: the separator that joins them
 * belongs to the sentence and changes with the language.
 *
 * The "N files were in use" line is its own key because it only renders when something
 * failed; the cleanup confirmation and the plan header are independent sentences too.
 */
const storageStats = {
  "storageStats.title": "Storage usage",
  "storageStats.refresh.aria": "Refresh storage usage",
  "storageStats.loadFailed": "Could not read the storage usage",
  "storageStats.summary":
    "The data directory takes up {size} in total ({count} files). Only sizes are shown; no file content is read or changed, and large folders (such as the application browser's user profile) are normal.",
  "storageStats.empty": "No local files have been created yet",

  "storageStats.recentBackupsHint": "The 3 most recent backups never appear in the list",

  "storageStats.cleanup.action": "Clean up old files",
  "storageStats.cleanup.title": "Clean up old files",
  "storageStats.cleanup.nothing": "Nothing older than {days} days to clean up right now",
  "storageStats.cleanup.planFailed": "Could not read the cleanup list",

  "storageStats.cleanup.plan.title":
    "These files have not changed in over {days} days; the selected categories total {size} ({count} items)",
  "storageStats.cleanup.plan.description":
    "Cleanup moves them to the trash folder inside the local data directory (one subfolder per run); nothing is deleted for good. Once you are sure, you can delete that folder from your file manager.",
  "storageStats.cleanup.plan.kept": "{hint} ({count} kept this time).",
  "storageStats.category.files": "{files} files · {size}",
  "storageStats.cleanup.more":
    "{count} more files are not listed; confirm to move them all at once",

  "storageStats.cleanup.done.title": "Moved {count} files",
  "storageStats.cleanup.done.freed":
    "Freed {size}; the files were moved to the trash folder inside the local data directory and are not deleted for good.",
  "storageStats.cleanup.done.kept": "{hint}; {count} kept this time.",
  "storageStats.cleanup.done.busy": "{count} other files were in use and could not be moved.",
  "storageStats.cleanup.failed": "Cleanup failed",

  "storageStats.cleanup.okCount": "Move {count} files",
  "storageStats.cleanup.ok": "Move",
} as const;

export default storageStats;
