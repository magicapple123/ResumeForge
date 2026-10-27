// SPDX-License-Identifier: Apache-2.0
/**
 * Interview deep dive page: stat cards, history list, statuses and batch delete,
 * plus the start dialog (set the bar, pick claims, question count, feedback mode).
 *
 * The batch delete confirmation body uses `HARD_DELETE_NOTE` (the shared hard-delete
 * constant, paired with `TRASH_RECOVERY_NOTE`); that line stays Chinese until the two
 * constants are consolidated.
 */
const drill = {
  "drill.error.loadRecords": "Could not load records",
  "drill.error.load": "Could not load",
  "drill.toast.deletedOne": "Deleted this deep-dive record",
  "drill.error.deleteFailed": "Could not delete",
  "drill.confirm.deleteTitle": "Delete the selected deep-dive records?",
  "drill.toast.deletedMany": "Deleted {count} deep dives",
  "drill.toast.deletedPartial": "Deleted {ok}; {failed} failed — try again",
  "drill.selectMode": "Select",
  "drill.action.delete": "Delete",
  "drill.confirm.deleteOne": "Delete this deep dive?",
  "drill.action.back": "Back to the fact ledger",
  "drill.page.title": "Interview deep dive",
  "drill.page.subtitle":
    "Takes each confirmed claim from the fact ledger and stress-tests it: can you explain it clearly, and where does it still not hold up. The bar for each question is set before you see it, and no overall score is given.",
  "drill.stat.asked": "Asked",
  "drill.stat.clear": "Explained clearly",
  "drill.stat.partial": "Partly verified",
  "drill.stat.unverified": "Unverified",
  "drill.stat.contradiction": "Contradictions",
  "drill.status.finished": "Finished",
  "drill.status.active": "In progress",
  "drill.mode.simulated": "Simulation",
  "drill.mode.training": "Practice",
  "drill.section.history": "History",
  "drill.action.refresh": "Refresh",
  "drill.batch.delete": "Delete selected",
  "drill.empty":
    "No deep dives yet. Confirm a few claims in the fact ledger first, then come back and start one.",
  "drill.aria.select": "Select the deep dive {title}",
  "drill.action.continue": "Continue",
  "drill.action.review": "View retrospective",
  "drill.progress": "{current}/{total} questions",
  "drill.table.total": "{count} total",
  "drill.startPanel.title": "Deep dive from the fact ledger: set the bar first, then ask",
  "drill.startPanel.intro.title":
    "The bar for each question is set **before** you see it, and a fluent answer never loosens it.",
  "drill.startPanel.intro.description":
    "A deep dive gives no overall score. It answers one question: can you explain this claim clearly, and where does it still not hold up?",
  "drill.startPanel.claims.label": "Claims to test",
  "drill.startPanel.claims.hint": "(leave blank for all confirmed claims)",
  "drill.startPanel.claims.placeholder": "All confirmed claims",
  "drill.startPanel.claims.empty":
    "No confirmed entries in the fact ledger yet. Go to the fact ledger and confirm a few first.",
  "drill.startPanel.claims.option": "{title} ({level})",
  "drill.startPanel.maxQuestions.label": "Maximum questions",
  "drill.startPanel.maxQuestions.option": "{count} questions",
  "drill.startPanel.feedback.label": "Feedback",
  "drill.startPanel.feedback.deferred": "Simulation: feedback at the end",
  "drill.startPanel.feedback.immediate": "Practice: feedback after each question",
  "drill.startPanel.job.label": "Related job",
  "drill.startPanel.job.hint": "(optional, to pick questions closer to the job)",
  "drill.startPanel.job.placeholder": "No job (type keywords to search)",
  "drill.startPanel.action.open": "Start deep dive",
  "drill.startPanel.action.start": "Start",
  "drill.startPanel.toast.started": "The bar is set — get started",
  "drill.startPanel.error.startFailed": "Could not start the deep dive",
} as const;

export default drill;
