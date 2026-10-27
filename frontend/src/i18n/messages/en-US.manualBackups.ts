// SPDX-License-Identifier: Apache-2.0
/**
 * Settings · manual backups card: the snapshot list under `backups/`, single and batch
 * removal (always recoverable), and the note about snapshots already in the trash folder.
 *
 * Every sentence that used to be assembled from JSX fragments plus `formatSize()` /
 * `formatDateTime()` / a count is one key with `{size}` / `{time}` / `{count}` params -
 * splitting a sentence around an interpolation cannot be reordered for English.
 * `backups/` is a technical constant and stays inline in the Chinese and English text.
 */
const manualBackups = {
  "manualBackups.title": "Manual backups",
  "manualBackups.refresh.aria": "Refresh the manual backup list",
  "manualBackups.loadFailed": "Could not read the manual backups",

  "manualBackups.trashed":
    "Moved to the trash folder inside the local data directory; you can restore it or delete it for good from your file manager",

  "manualBackups.confirm.title": "Remove the backup [{name}]?",
  "manualBackups.confirm.size": "This backup takes about {size}; snapshot time: {time}.",
  "manualBackups.confirm.body":
    "Removing it puts it in the trash folder inside the local data directory, where you can always get it back from your file manager; nothing is cleaned up automatically.",
  "manualBackups.action.trash": "Move to trash",
  "manualBackups.removeFailed": "Could not remove the backup",

  "manualBackups.batch.confirm.title": "Remove the selected backups?",
  "manualBackups.batch.confirm.body":
    "These {count} backups go to the trash folder inside the local data directory, where you can always get them back from your file manager; nothing is cleaned up automatically.",
  "manualBackups.batch.partial": "Removed {done}; {failed} could not be removed",
  "manualBackups.batch.done":
    "Moved {count} backups to the trash folder inside the local data directory",

  "manualBackups.intro":
    "These are the database snapshots that migrations and manual backups left in the backups/ folder. Nothing is cleaned up automatically; once you confirm, they are moved to the trash folder inside the local data directory and can still be recovered.",
  "manualBackups.action.removeSelected": "Remove selected",
  "manualBackups.empty":
    "No manual backup snapshots yet. One is saved here automatically before a database upgrade.",

  "manualBackups.action.remove": "Remove",
  "manualBackups.more.aria": "More actions for the backup {name}",
  "manualBackups.select.aria": "Select the backup {name}",

  "manualBackups.trashNote":
    "The trash folder inside the local data directory still holds {count} removed snapshots; delete them from your file manager once you are sure you no longer need them.",
} as const;

export default manualBackups;
