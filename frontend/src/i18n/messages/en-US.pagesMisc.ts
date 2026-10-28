// SPDX-License-Identifier: Apache-2.0
/**
 * The remaining copy of four pages: the apply desk, the interview deep-dive page, Home
 * and the job board.
 *
 * The deep-dive page's statistics, history list and start dialog live in
 * `en-US.drill.ts`; only the two halves of the "how to open a session" hint at the bottom
 * of that page are here.
 */
const pagesMisc = {
  // ── Apply desk (ApplyPage) ─────────────────────────────────────
  "pagesMisc.applyPage.title": "Apply desk",
  "pagesMisc.applyPage.subtitle":
    "Collect jobs → judge the match → confirm each one → apply automatically. Every action on a job site starts with you, and you sign in inside your own browser window.",
  "pagesMisc.applyPage.action.settings": "Apply settings",
  "pagesMisc.applyPage.progress.loading": "Loading the task progress…",
  "pagesMisc.applyPage.progress.notFound":
    "This task record no longer exists; it may have been cleaned up.",
  "pagesMisc.applyPage.tab.queue": "Apply queue",
  "pagesMisc.applyPage.tab.collect": "Auto collect",
  "pagesMisc.applyPage.tab.collectRecords": "Collection records",
  "pagesMisc.applyPage.tab.records": "Apply records",
  "pagesMisc.applyPage.tab.referrals": "Referrals",
  /** Fallback reason when pausing / resuming / stopping fails; the guidance adds the rest. */
  "pagesMisc.applyPage.error.controlFailed": "Could not adjust the task",

  // ── Interview deep dive (DrillPage): only the bottom hint is left ──
  /** The half before the plus icon. */
  "pagesMisc.drillPage.openHint.before":
    "Click Continue or View retrospective above to open a session, or",
  /** The half after the plus icon. */
  "pagesMisc.drillPage.openHint.after": "start a new one.",

  // ── Home (HomePage) ────────────────────────────────────────────
  /** Banner title when loading fails; `{error}` is the raw error message. */
  "pagesMisc.homePage.loadFailed.title": "Home data failed to load: {error}",
  "pagesMisc.homePage.section.todos": "What to do next",
  "pagesMisc.homePage.loading": "Loading…",
  "pagesMisc.homePage.todos.empty":
    "Nothing needs doing right now. Collect a few jobs on the Job board, or talk through the next step with the Job assistant.",
  /** To-do 1: claims that are not verified yet. */
  "pagesMisc.homePage.todo.claims.text": "{count} claims still need verifying",
  "pagesMisc.homePage.todo.claims.hint":
    "Unverified claims cannot enter a final resume; export stops on them",
  /** To-do 2: jobs waiting in the apply queue. */
  "pagesMisc.homePage.todo.queue.text": "{count} jobs are waiting in the apply queue",
  "pagesMisc.homePage.todo.queue.hint": "Line them up, start the browser and they go out",
  /** To-do 3: applications with no movement for over a week. */
  "pagesMisc.homePage.todo.stalled.text": "{count} applications have not moved for over a week",
  "pagesMisc.homePage.todo.stalled.hint": "See whether any needs a follow-up or a new status",

  // ── Job board (JobsPage) ──────────────────────────────────────
  "pagesMisc.jobsPage.error.deleteFailed": "Delete failed",
  "pagesMisc.jobsPage.error.favoriteFailed": "Could not update the favorite",
  "pagesMisc.jobsPage.toast.webFormOpened":
    "Opened the application page in the dedicated web-form browser",
  "pagesMisc.jobsPage.error.webFormFailed": "Could not open the web form page",
  "pagesMisc.jobsPage.backfill.none": "No jobs on this page need their descriptions filled in",
  /** `{count}` is how many jobs get their descriptions filled in. */
  "pagesMisc.jobsPage.backfill.started":
    "Started filling in descriptions for {count} jobs; follow the progress in Apply desk → Auto collect",
  "pagesMisc.jobsPage.error.backfillFailed": "Could not fill in the descriptions",
  "pagesMisc.jobsPage.match.enteredSelection":
    "Selection mode is on; tick at least two jobs to compare them",
  "pagesMisc.jobsPage.match.needJobs": "Select at least one job first",
  "pagesMisc.jobsPage.match.needCompareJobs": "Pick at least two jobs to compare",
  "pagesMisc.jobsPage.match.tooMany": "You can analyze up to 50 jobs at a time",
  "pagesMisc.jobsPage.match.tooManyCompare": "You can compare up to 12 jobs at a time",
  "pagesMisc.jobsPage.candidate.imported": "Candidate job imported into the job list",
  "pagesMisc.jobsPage.candidate.markFailed": "Could not mark the import status",
} as const;

export default pagesMisc;
