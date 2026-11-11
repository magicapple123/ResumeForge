// SPDX-License-Identifier: Apache-2.0
/** Assistant breadth (#18A/#18B/#18C): task strip, daily digest card, persona switcher. */
const assistantBreadth = {
  "assistantBreadth.tasks.title": "Assistant tasks",
  "assistantBreadth.tasks.hint":
    "Long-running batch work created by the assistant runs here. Step progress is saved across restarts; you can pause or cancel it.",
  "assistantBreadth.tasks.show": "Show tasks",
  "assistantBreadth.tasks.hide": "Hide tasks",
  "assistantBreadth.tasks.pause": "Pause",
  "assistantBreadth.tasks.aria": "Tasks created by the assistant",

  "assistantBreadth.digest.title": "Today's brief",
  "assistantBreadth.digest.refresh": "Regenerate",
  "assistantBreadth.digest.refreshing": "Regenerating…",
  "assistantBreadth.digest.generatedAt": "Updated {time}",
  "assistantBreadth.digest.error": "Could not build the brief. Please try again.",
  "assistantBreadth.digest.empty": "Nothing needs your attention today.",
  "assistantBreadth.digest.changes": "{count} changes",
  "assistantBreadth.digest.changesDetail": "{jdChanged} JD changes · {stale} silent applications",
  "assistantBreadth.digest.more": "{count} more",
  "assistantBreadth.digest.section.worth_jobs": "New jobs worth applying",
  "assistantBreadth.digest.section.stale_applications": "Silent for 7+ days",
  "assistantBreadth.digest.section.interviews": "Interview countdown",
  "assistantBreadth.digest.section.expired_jobs": "Expired / delisted",
  "assistantBreadth.digest.section.funnel": "This week's funnel",
  "assistantBreadth.digest.score": "Reference score {score}",
  "assistantBreadth.digest.scoreHint":
    "The reference score is estimated by local rules, for ordering only; it does not predict success. Admission still follows the match verdict.",
  "assistantBreadth.digest.staleDays": "No reply for {days} days",
  "assistantBreadth.digest.daysUntil": "In {days} days",
  "assistantBreadth.digest.today": "Today",
  "assistantBreadth.digest.interviewToday": "{count} interviews today",
  "assistantBreadth.digest.funnel.applied": "Applied {count}",
  "assistantBreadth.digest.funnel.succeeded": "Succeeded {count}",
  "assistantBreadth.digest.funnel.failed": "Failed {count}",
  "assistantBreadth.digest.funnel.interviewing": "Interviewing {count}",
  "assistantBreadth.digest.hint":
    "The brief reads existing data only (match analyses, application records, tracker, job status); it never fetches job pages.",

  "assistantBreadth.persona.label": "Perspective",
  "assistantBreadth.persona.default": "General",
  "assistantBreadth.persona.hr_scan": "HR 6-second scan",
  "assistantBreadth.persona.interviewer": "Interviewer follow-ups",
  "assistantBreadth.persona.headhunter": "Headhunter call",
  "assistantBreadth.persona.hint":
    "A perspective only changes how the assistant reads the problem and structures its answer; tools and permissions stay the same.",
  "assistantBreadth.persona.switched": "Perspective switched to {name}",
  "assistantBreadth.persona.error": "Could not switch the perspective. Please try again.",
  "assistantBreadth.persona.needsConversation":
    "Send the first message before switching perspectives",
  "assistantBreadth.persona.aria": "Assistant perspective",
} as const;

export default assistantBreadth;
