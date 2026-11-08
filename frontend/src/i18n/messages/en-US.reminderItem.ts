// SPDX-License-Identifier: Apache-2.0
/** 求职进度里的提醒行：勾选、完成/忽略、详情与菜单。 */
const reminderItem = {
  "reminderItem.aria.select": "Select the reminder {title}",
  "reminderItem.action.detail": "Details",
  "reminderItem.aria.done": "Mark the reminder {title} as done",
  "reminderItem.action.done": "Done",
  "reminderItem.aria.ignore": "Ignore the reminder {title}",
  "reminderItem.action.ignore": "Ignore",
  "reminderItem.action.edit": "Edit",
  "reminderItem.action.delete": "Delete",
  "reminderItem.confirm.delete": "Delete this reminder?",
  /** Overdue tag (T06): only when pending and days_until < 0; `{days}` is the overdue days. */
  "reminderItem.tag.overdue": "{days}d overdue",
} as const;

export default reminderItem;
