// SPDX-License-Identifier: Apache-2.0
/**
 * Interview deep dive page: stat cards, history list, statuses and batch delete, the start
 * dialog (set the bar, pick claims, question count, feedback mode), and the review panel with
 * its action list and rehearsal queue.
 *
 * The batch delete confirmation body (`drill.confirm.deleteManyBody`) takes the count through
 * `{count}` and the consequence through `{note}` (`common.note.hardDelete`).
 */
const drill = {
  "drill.error.loadRecords": "Could not load records",
  "drill.error.load": "Could not load",
  "drill.toast.deletedOne": "Deleted this deep-dive record",
  "drill.error.deleteFailed": "Could not delete",
  "drill.confirm.deleteTitle": "Delete the selected deep-dive records?",
  "drill.confirm.deleteManyBody": "Delete these {count} deep dives. {note}",
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
  "drill.rehearsal.intro":
    "Rehearsal never repeats the original question — it asks again from another angle. Reciting last time's answer does not count as knowing it.",
  "drill.rehearsal.empty":
    "The rehearsal queue is empty — nothing in this session needs another pass.",
  "drill.rehearsal.action.ask": "Ask one",
  "drill.rehearsal.error.failed": "Could not generate a question",
  "drill.rehearsal.kind.variant": "Variant",
  "drill.rehearsal.kind.counterfactual": "Counterfactual",
  "drill.rehearsal.kind.failure": "Failure case",
  "drill.rehearsal.kind.evidence": "Evidence",
  "drill.rehearsal.kind.compress": "Compressed answer",
  "drill.rehearsal.result.title": "Rehearsal: {label}",
  "drill.rehearsal.result.expect": "This question asks for: {expect}",
  "drill.rehearsal.result.note":
    "This only writes a question and is not recorded in this session. To practice for real, talk through the question yourself.",
  "drill.rehearsal.action.close": "Close",
  "drill.review.verified.title": "Explained clearly",
  "drill.review.gaps.title": "Still not solid",
  "drill.review.actions.title": "Action list before the interview",
  "drill.review.rehearsal.title": "Rehearsal queue",
  // Action kinds are protocol values from the backend; these are their display names.
  "drill.review.kind.addFact": "Add facts",
  "drill.review.kind.addKnowledge": "Fill knowledge gaps",
  "drill.review.kind.downgradeClaim": "Soften the claim",
  "drill.review.hint.addFact":
    "You did this work but never wrote down the details — add the decisions, hard parts and exact wording.",
  "drill.review.hint.addKnowledge": "You genuinely do not know this yet — go learn it.",
  "drill.review.hint.downgradeClaim":
    "The facts do not hold up — soften that line on your resume instead of forcing it.",
} as const;

export default drill;
