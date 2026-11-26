// SPDX-License-Identifier: Apache-2.0
/** Notification inbox copy: header bell, unread badge, list (today/earlier), empty state. */
const notifications = {
  "notifications.bell.aria": "Notifications",
  /** Relative time in the event row subtitle (#13); `{time}` is the clock time. */
  "notifications.relative.today": "Today {time}",
  "notifications.relative.yesterday": "Yesterday {time}",
  /** Accessible name for the bell (#14): counts the unread items, which the badge hides. */
  "notifications.bell.ariaUnread": "Notifications, {count} unread",
  "notifications.title": "Notifications",
  "notifications.group.today": "Today",
  "notifications.group.earlier": "Earlier",
  "notifications.empty": "All caught up",
  "notifications.action.readAll": "Mark all read",
  "notifications.action.retry": "Retry",
  "notifications.unread.mark": "Mark as read",
  "notifications.error.load": "Couldn't load notifications. Try again later.",
  "notifications.error.read": "Couldn't mark as read. Try again later.",
};

export default notifications;
