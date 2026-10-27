// SPDX-License-Identifier: Apache-2.0
/**
 * Settings · automatic backup status card: the protection label and its explanation,
 * the interval picker, the last successful backup and the automatic snapshot list.
 *
 * Status text is grouped by the backend `state` value: one `label` per state, plus a
 * `hint` for the three states that need one (unreadable folder, missing snapshot,
 * disabled by configuration).
 *
 * The interval sentence is a prefix, the picker, then one whole sentence. English word
 * order puts the number inside the sentence ("Every 7 days, ..."), so the sentence
 * after the picker starts with its own separator and the retention note is part of it
 * instead of a separate fragment.
 */
const backupStatus = {
  "backupStatus.title": "Automatic backup status",
  "backupStatus.refresh.aria": "Refresh the backup status",

  "backupStatus.state.disabled.label": "Automatic backups disabled",
  "backupStatus.state.disabled.hint":
    "Automatic backups are disabled (controlled by the deployment configuration); you can still export a backup manually.",
  "backupStatus.state.unreadable.label": "Cannot confirm",
  "backupStatus.state.unreadable.hint":
    "Could not read the snapshot folder; check disk permissions. Whether the snapshots exist cannot be confirmed right now.",
  "backupStatus.state.failing.label": "Protection interrupted",
  "backupStatus.state.never.label": "No backups yet",
  "backupStatus.state.empty.label": "Snapshot missing",
  "backupStatus.state.empty.hint":
    "The last success is recorded, but the snapshot file is missing; run a backup again.",
  "backupStatus.state.overdue.label": "Backup overdue",
  "backupStatus.state.protected.label": "Protected",

  "backupStatus.interval.aria": "Automatic backup interval (days)",
  "backupStatus.interval.optionDays": "{count} days",
  "backupStatus.interval.prefix": "Every",
  "backupStatus.interval.suffix":
    ", an automatic snapshot is taken (database snapshots only, no attachment files); only backups exported by hand include attachments. Only the latest few are kept; manual backups are unaffected.",
  "backupStatus.interval.suffixDisabled":
    ", the automatic snapshot count is controlled by the deployment configuration; backups exported by hand still include attachments. Only the latest few are kept; manual backups are unaffected.",
  "backupStatus.interval.saved":
    "Automatic backup interval changed to every {count} days; it takes effect at the next scheduled check",
  "backupStatus.interval.saveFailed": "Could not save the automatic backup interval",

  "backupStatus.lastSuccess": "Last successful backup: {time}",
  "backupStatus.lastSuccess.never": "No automatic backup has succeeded yet.",
  "backupStatus.coverage.databaseOnly":
    "Automatic backups cover database snapshots only, not attachments or fonts; to back up attachments and fonts too, use [Export dataset / Export all datasets] on the Datasets card.",
  "backupStatus.failures":
    "Backup failed {count} times in a row: {error}. The system retries automatically at a short interval.",
  "backupStatus.snapshots.empty":
    "No automatic snapshots yet; they are listed here after the first successful backup.",
} as const;

export default backupStatus;
