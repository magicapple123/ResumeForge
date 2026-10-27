// SPDX-License-Identifier: Apache-2.0
/**
 * Home page: stats cards, the three "latest activity" cards, the reminder card and
 * its startup dialog, and the global search card.
 *
 * Protocol values stay in the components: the reminder `Segmented` uses
 * `list` / `calendar`, urgency uses `overdue` / `soon` / `upcoming` / `later`,
 * and search hit groups are keyed by `referral` / `reminder` / ... Only their
 * display names live here.
 *
 * "List / Month" also appears in the tracker reminder pack (`reminder.view.*`).
 * The home card owns its own switcher, so the two screens do not share keys.
 */
const homePage = {
  // -- Stats cards ------------------------------------------------
  /** Total number of jobs. */
  "homePage.stats.jobCount": "Total jobs",
  /** Jobs whose status is open. */
  "homePage.stats.openJobCount": "Open jobs",
  /** Resumes generated so far. */
  "homePage.stats.resumeCount": "Resumes generated",
  /** Resumes generated in the last 7 days. */
  "homePage.stats.weekResumeCount": "Generated in the last 7 days",

  // -- Links in card headers and rows -----------------------------
  /** Header link on the recent jobs, recent resumes and reminders cards. */
  "homePage.action.viewAll": "View all",
  /** Header link on the recent applications card. */
  "homePage.action.viewProgress": "Track progress",

  // -- Latest activity cards --------------------------------------
  /** Recent jobs card title. */
  "homePage.latest.jobs.title": "Recent jobs",
  /** Empty state: name the page where jobs are added. */
  "homePage.latest.jobs.empty": "No jobs yet - add one on the Job board",
  /** Recent resumes card title. */
  "homePage.latest.resumes.title": "Recent resumes",
  /** Empty state when no resume has been generated yet. */
  "homePage.latest.resumes.empty": "No resumes yet - pick a job on the Job board",
  /** Recent applications card title. */
  "homePage.latest.applications.title": "Recent applications",
  /** Fallback when an application has no job title. */
  "homePage.latest.untitledJob": "Untitled job",

  // -- Reminder card and startup dialog ---------------------------
  /** Card title and startup dialog title. */
  "homePage.reminders.title": "Upcoming reminders",
  /** Dialog footer button that closes it. */
  "homePage.reminders.gotIt": "Got it",
  /** Accessible name of the list / month switcher. */
  "homePage.reminders.viewSwitchAria": "Switch reminder view",
  /** Switcher option: list view. */
  "homePage.reminders.view.list": "List",
  /** Switcher option: month view. */
  "homePage.reminders.view.calendar": "Month",
  /** Empty state when nothing is coming up. */
  "homePage.reminders.empty": "No reminders coming up",
  /** Urgency display name: the reminder time has passed. */
  "homePage.reminders.urgency.overdue": "Overdue",
  /** Urgency display name: due soon. */
  "homePage.reminders.urgency.soon": "Due soon",
  /** Urgency display name: the reminder time is still ahead. */
  "homePage.reminders.urgency.upcoming": "Not due yet",
  /** Urgency display name: the reminder time is further out. */
  "homePage.reminders.urgency.later": "Later",
  /** Fallback when the backend sends an unknown urgency. */
  "homePage.reminders.urgency.unknown": "Unknown",
  /** Accessible name of the urgency dot; `{level}` is the display name above. */
  "homePage.reminders.urgencyAria": "Urgency: {level}",
  /** Accessible name of a reminder row: clicking it opens the dialog. */
  "homePage.reminders.openAria": "View reminder: {title}",

  // -- Global search card -----------------------------------------
  /** Card title. */
  "homePage.search.title": "Global search",
  /** Search box placeholder: lists the searched areas and gives an example. */
  "homePage.search.placeholder":
    "Search jobs, resumes, referrals, reminders, interview notes, fact ledger, materials or skills, e.g. marketing / accounting",
  /** Search button. */
  "homePage.search.action": "Search",
  /** Fallback when the request fails without a message. */
  "homePage.search.failed": "Search failed - please try again",
  /** Jobs group heading; `{count}` is the number of hits. */
  "homePage.search.jobsTitle": "Matching jobs ({count})",
  /** Empty state when no job matches. */
  "homePage.search.jobsEmpty": "No matching jobs",
  /** Fallback when a job has no salary. */
  "homePage.search.salaryNegotiable": "Salary negotiable",
  /** Resumes group heading; `{count}` is the number of hits. */
  "homePage.search.resumesTitle": "Matching resumes ({count})",
  /** Empty state when no resume matches. */
  "homePage.search.resumesEmpty": "No matching resumes",
  /** Heading of the whole "more results" block; `{count}` is the number of hits. */
  "homePage.search.moreTitle": "More results ({count})",
  /** One area group heading; `{name}` is one of the six display names below. */
  "homePage.search.groupHeading": "{name} ({count})",
  /** Search area display name: referrals. */
  "homePage.search.more.referral": "Referrals",
  /** Search area display name: reminders. */
  "homePage.search.more.reminder": "Reminders",
  /** Search area display name: interview notes. */
  "homePage.search.more.experience": "Interview notes",
  /** Search area display name: the fact ledger. */
  "homePage.search.more.claim": "Fact ledger",
  /** Search area display name: materials. */
  "homePage.search.more.material": "Materials",
  /** Search area display name: skills. */
  "homePage.search.more.skill": "Skills",
} as const;

export default homePage;
