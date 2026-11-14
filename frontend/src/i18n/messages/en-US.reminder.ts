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
  /** Time-range filter (T06): All / Overdue / Today / Later. */
  "reminder.filter.range.placeholder": "Time range",
  "reminder.filter.range.all": "All",
  "reminder.filter.range.overdue": "Overdue",
  "reminder.filter.range.today": "Today",
  "reminder.filter.range.future": "Later",
  /** Empty state when the current filter matches nothing (distinct from "no reminders yet"). */
  "reminder.emptyFiltered": "No reminders match the current filters",
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
  /** New reminders must be in the future; edits are exempt (fixing notes must not be blocked). */
  "reminder.required.futureTime": "The reminder time must be later than now",
  /** Task-card hint under the time field: switch is on. */
  "reminder.hint.taskCardOn":
    "A task card titled Prepare: <reminder> will appear on the Home page when it is due",
  /** Task-card hint under the time field: switch is off. */
  "reminder.hint.taskCardOff": "Task cards are off — you will be reminded, but no card is created",
  "reminder.field.kind": "Type",
  /** Header of the three link fields (collapsed by default). */
  "reminder.field.linkSection": "Links (optional)",
  /** Count next to the collapsed header; `{count}` is how many links are filled. */
  "reminder.field.linkedCount": "{count} linked",
  "reminder.field.track": "Application progress (optional)",
  "reminder.placeholder.track": "Search application progress by keyword",
  "reminder.field.job": "Job (optional)",
  "reminder.placeholder.job": "Search Jobs by keyword",
  "reminder.field.resume": "Resume (optional)",
  "reminder.placeholder.resume": "Search Resumes by keyword",
  "reminder.field.note": "Notes",
  "reminder.placeholder.note": "Optional notes",

  "reminder.detail.title": "Reminder details",
  "reminder.detail.track": "Application progress",
  "reminder.detail.job": "Job",
  "reminder.detail.resume": "Resume",
  "reminder.detail.createdAt": "Created",
  "reminder.detail.updatedAt": "Updated",
  "reminder.action.markDone": "Mark as done",
  "reminder.action.edit": "Edit",
} as const;

export default reminder;
