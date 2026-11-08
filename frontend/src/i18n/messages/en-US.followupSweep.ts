// SPDX-License-Identifier: Apache-2.0
/**
 * Follow-up sweep card (T06): source badge, bucket hints, the three outcomes and
 * whole-card submission copy. Card titles come from the backend template and are
 * rendered as data; only UI-owned wording lives here.
 */
const followupSweep = {
  "followupSweep.sourceBadge": "Follow-up sweep",
  "followupSweep.aria.card": "Follow-up sweep card",
  "followupSweep.kind.followup": "Follow-up list",
  "followupSweep.kind.confirm": "Confirm status",
  "followupSweep.kindHint.followup":
    "Pick one outcome per job and save them together; this only records your choice and never changes the stage in your tracked applications.",
  "followupSweep.kindHint.confirm":
    "These jobs have had no recorded status change for a while, so confirm where they stand; this only records your choice and never changes the stage.",
  "followupSweep.decision.aria": "Outcome for {title}",
  "followupSweep.decision.contacted": "Contacted",
  "followupSweep.decision.replied": "Heard back",
  "followupSweep.decision.stopped": "Stop following",
  "followupSweep.action.submit": "Record these {count} outcomes",
  "followupSweep.state.stepDone": "Recorded",
  "followupSweep.state.done": "This card is done",
  "followupSweep.hint.incomplete": "{count} still need an outcome",
  "followupSweep.hint.partial": "{count} are still undecided; you can save the selected ones first",
  "followupSweep.toast.submitted": "Recorded {count} follow-up outcomes",
  "followupSweep.toast.idempotent": "These outcomes were already recorded",
  "followupSweep.error.submit": "The outcomes were not saved. Try again.",
} as const;

export default followupSweep;
