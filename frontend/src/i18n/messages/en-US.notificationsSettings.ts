// SPDX-License-Identifier: Apache-2.0
/** "Notifications" settings group (CR-29): six switches plus quiet hours. */
const enUSNotificationsSettings = {
  "notificationsSettings.nav": "Notifications",
  "notificationsSettings.intro":
    "Decide what may interrupt you: things that need your decision speak up by default; results stay quiet.",
  "notificationsSettings.summary": "Decisions interrupt by default; results stay quiet by default.",
  "notificationsSettings.loadFailed": "Could not load the notification settings",
  "notificationsSettings.saveFailed": "Could not save the notification settings",
  "notificationsSettings.reminderDue.label": "Reminder due",
  "notificationsSettings.reminderDue.hint":
    "Records a notification when a reminder comes due, shown in the header bell.",
  "notificationsSettings.taskWaiting.label": "Needs your confirmation",
  "notificationsSettings.taskWaiting.hint":
    "Tells you when an assistant task is waiting for your confirmation — it will not continue without you.",
  "notificationsSettings.taskDone.label": "Task finished",
  "notificationsSettings.taskDone.hint":
    "Notice when a resume generation or batch analysis finishes. Off by default: the bell keeps the result.",
  "notificationsSettings.batchDone.label": "Batch finished",
  "notificationsSettings.batchDone.hint":
    "Notice when an apply or collect batch finishes. Off by default: the bell keeps the result.",
  "notificationsSettings.sound.label": "Sound",
  "notificationsSettings.sound.hint":
    "Plays two short notes whenever a notice appears; turn it off for total silence.",
  "notificationsSettings.quietHours.label": "Quiet hours",
  "notificationsSettings.quietHours.hint":
    "No pop-ups or sounds between {start} and {end}; notifications are still recorded in the bell.",
  "notificationsSettings.waiting.badge": "{count} task(s) waiting for your confirmation",
  "notificationsSettings.waiting.action": "Review",
};

export default enUSNotificationsSettings;
