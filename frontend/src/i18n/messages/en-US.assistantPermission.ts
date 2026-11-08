// SPDX-License-Identifier: Apache-2.0
/**
 * Job assistant data permission (T11, four levels).
 *
 * One level decides two axes at once: read (whether real identity fields are visible) and
 * write (whether the assistant may change data directly). Settings holds the global default;
 * the composer dropdown only overrides the current conversation, stored on this device.
 */
const assistantPermission = {
  "assistantPermission.label": "Data permission",
  "assistantPermission.menu.aria": "Assistant data permission",
  "assistantPermission.menu.hint":
    "Overrides the current conversation only; the global default lives in Settings",
  "assistantPermission.followGlobal": "Follow global",
  "assistantPermission.followGlobalWith": "Follow global ({level})",
  // The "follow global" row needs its own description: it explains that this is the
  // Settings default and that changing it here affects this conversation only, while the
  // four level descriptions explain what each level may read or write.
  "assistantPermission.followGlobal.desc":
    "Uses the global default from Settings (currently: {level}); changing it here only affects this conversation",
  "assistantPermission.followGlobalHint": "Send your first message to adjust this",
  "assistantPermission.level.read_only": "View only",
  "assistantPermission.level.read_full": "Full read",
  "assistantPermission.level.write_confirm": "Can edit",
  "assistantPermission.level.write_full": "Full access",
  "assistantPermission.level.read_only.desc": "Read-only, sensitive fields masked",
  "assistantPermission.level.read_full.desc": "Read real names, phone numbers and more",
  "assistantPermission.level.write_confirm.desc": "Can edit data, reads stay masked",
  "assistantPermission.level.write_full.desc": "Read real data and edit it directly",
  "assistantPermission.notice.readFull.title": "Full read is on for this conversation",
  "assistantPermission.notice.readFull.body":
    "The assistant can see real names, phone numbers, emails and submitted form values; this content is sent to the configured model service.",
  "assistantPermission.notice.writeFull.title": "Full access is on for this conversation",
  "assistantPermission.notice.writeFull.body":
    "The assistant can read real data and change your data directly without asking each time. You can switch back anytime.",
  "assistantPermission.notice.closeAria": "Dismiss this permission notice",
  "assistantPermission.confirm.title": "Turn on {level}?",
  "assistantPermission.confirm.body":
    "The assistant will change your data directly without asking each time. You can switch back anytime.",
  "assistantPermission.confirm.ok": "Turn on",
  "assistantPermission.confirm.cancel": "Not now",
  "assistantPermission.settings.title": "Job assistant · Data permission",
  "assistantPermission.settings.intro":
    "This is the global default; the composer dropdown only overrides the current conversation. The level decides what the assistant may read and whether it may edit data directly.",
  "assistantPermission.settings.aria": "Global data permission level",
  "assistantPermission.settings.state": "Global default: {level}",
  "assistantPermission.settings.saveToast": "Global data permission changed to {level}",
  "assistantPermission.settings.saveFailed":
    "Could not save the data permission setting, try again later",
  "assistantPermission.settings.writeHint":
    "Write levels let the assistant edit your data directly without asking each time.",
  "assistantPermission.settings.neverSent":
    "No level ever sends API keys or credential values, resume photo binaries are never sent, and the assistant has no delete tools.",
} as const;

export default assistantPermission;
