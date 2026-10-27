// SPDX-License-Identifier: Apache-2.0
/**
 * Month calendar (CalendarView) and tracker card (TrackCard): month navigation, day-cell
 * accessible names, day details, and the display names for tracker status / record source
 * and reminder type / status.
 *
 * Reminder types / statuses and record sources are protocol values (English codes, see
 * `types/reminder.ts` / `types/tracker.ts`, matching the backend verbatim). The components
 * map them to keys with `Record<…, MessageKey>` tables. Tracker status names reuse
 * `trackerForm.status.*` so one protocol value keeps one name everywhere. The Chinese
 * tables in `types/*.ts` are untouched (the reminder panel and reminder rows still read
 * the reminder type / status tables).
 */
const trackerUi = {
  "trackerUi.calendar.prevMonth": "Previous month",
  "trackerUi.calendar.nextMonth": "Next month",
  "trackerUi.calendar.thisMonth": "Back to this month",
  "trackerUi.calendar.monthTitle": "MMMM YYYY",
  "trackerUi.calendar.dayTitle": "MMMM D, YYYY",
  "trackerUi.calendar.hint": "Click a date to see that day's schedule",
  "trackerUi.calendar.weekday.mon": "Mon",
  "trackerUi.calendar.weekday.tue": "Tue",
  "trackerUi.calendar.weekday.wed": "Wed",
  "trackerUi.calendar.weekday.thu": "Thu",
  "trackerUi.calendar.weekday.fri": "Fri",
  "trackerUi.calendar.weekday.sat": "Sat",
  "trackerUi.calendar.weekday.sun": "Sun",
  "trackerUi.calendar.dayAria": "{date}, {count} reminders, view that day's schedule",
  "trackerUi.calendar.dayAriaEmpty": "{date}, view that day's schedule",
  "trackerUi.calendar.monthEmpty":
    "No reminders this month — record interviews and assessment deadlines here",
  "trackerUi.calendar.detailTitle": "{date} · {count} reminders",
  "trackerUi.calendar.dayEmpty": "Nothing scheduled for this day",

  "trackerUi.reminderKind.interview": "Interview",
  "trackerUi.reminderKind.assessmentDeadline": "Assessment / test deadline",
  "trackerUi.reminderKind.hrReply": "Chase HR for a reply",
  "trackerUi.reminderKind.other": "Other",
  "trackerUi.reminderStatus.pending": "To do",
  "trackerUi.reminderStatus.done": "Done",
  "trackerUi.reminderStatus.dismissed": "Dismissed",

  "trackerUi.card.emptyCompany": "(No company)",
  "trackerUi.card.emptyTitle": "(No Job title)",
  "trackerUi.card.action.edit": "Edit",
  "trackerUi.card.action.delete": "Delete",
  "trackerUi.card.aria.more": "More actions for {name}",
  "trackerUi.card.fallbackName": "this entry",
  "trackerUi.card.appliedAt": "Applied on {date}",
  "trackerUi.card.statusDate": "Status updated on {date}",
  "trackerUi.card.resume": "Resume: {title}",
  "trackerUi.card.resumeHistorical": "(historical link)",
  "trackerUi.card.nextStep": "Next step",
  "trackerUi.card.emptyNextAction": "(Nothing entered)",
  "trackerUi.card.overdue": "Overdue",
  "trackerUi.card.evidence": "Evidence: {evidence}",

  "trackerUi.source.apply": "Auto-logged from the apply console",
  "trackerUi.source.manual": "Added manually",
  "trackerUi.source.recognized": "Imported from messages",
} as const;

export default trackerUi;
