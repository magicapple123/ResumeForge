// SPDX-License-Identifier: Apache-2.0
/** 提醒面板（与 zh-CN.reminder.ts 一一对应）。 */
const reminder = {
  "reminder.toast.loadFailed": "Could not load reminders",
  "reminder.toast.created": "Reminder created",
  "reminder.toast.updated": "Reminder updated",
  "reminder.toast.saveFailed": "Could not save the reminder",
  "reminder.toast.done": "Marked as done",
  "reminder.toast.ignored": "Dismissed",
  "reminder.toast.updateFailed": "Could not update the reminder",
  "reminder.toast.deleted": "Deleted {count} reminders",
  "reminder.toast.deletedPartial": "Deleted {ok}; {failed} failed — try again",
  "reminder.toast.deletedOne": "Reminder deleted",
  "reminder.toast.deleteFailed": "Could not delete",

  "reminder.confirm.deleteTitle": "Delete the selected reminders?",
  "reminder.confirm.deleteBody":
    "These {count} reminders will move to the Trash, where you can restore them.",
  "reminder.confirm.deleteOneTitle": "Delete this reminder?",
  "reminder.confirm.deleteOneBody":
    "This reminder will move to the Trash, where you can restore it.",

  "reminder.selectMode": "Select",
  "reminder.card.title": "Calendar reminders",
  "reminder.filter.placeholder": "Filter by type",
  "reminder.action.create": "New reminder",
  "reminder.view.list": "List",
  "reminder.view.calendar": "Month",
  "reminder.empty": "No reminders yet — record interviews and assessment deadlines here",
  "reminder.batch.delete": "Delete selected",
  "reminder.table.total": "{count} total",

  "reminder.modal.edit": "Edit reminder",
  "reminder.modal.save": "Save reminder",
  "reminder.field.content": "Reminder",
  "reminder.required.content": "Enter a reminder",
  "reminder.placeholder.content": "e.g. Second-round interview at Acme",
  "reminder.field.time": "When",
  "reminder.required.time": "Choose a time",
  "reminder.field.kind": "Type",
  "reminder.field.track": "Pipeline (optional)",
  "reminder.placeholder.track": "Search pipelines by keyword",
  "reminder.field.job": "Job (optional)",
  "reminder.placeholder.job": "Search Jobs by keyword",
  "reminder.field.resume": "Resume (optional)",
  "reminder.placeholder.resume": "Search Resumes by keyword",
  "reminder.field.note": "Notes",
  "reminder.placeholder.note": "Optional notes",

  "reminder.detail.title": "Reminder details",
  "reminder.detail.track": "Pipeline",
  "reminder.detail.job": "Job",
  "reminder.detail.resume": "Resume",
  "reminder.detail.createdAt": "Created",
  "reminder.detail.updatedAt": "Updated",
  "reminder.detail.none": "(None)",
  "reminder.action.markDone": "Mark as done",
  "reminder.action.edit": "Edit",
} as const;

export default reminder;
