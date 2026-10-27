// SPDX-License-Identifier: Apache-2.0
/** 投递队列页（与 zh-CN.applyQueue.ts 一一对应）。 */
const applyQueue = {
  "applyQueue.action.viewDetail": "View details",
  "applyQueue.action.edit": "Edit",
  "applyQueue.action.remove": "Remove from queue",
  "applyQueue.action.removeShort": "Remove",
  "applyQueue.confirm.removeTitle": "Remove from the queue?",
  "applyQueue.confirm.removeBody":
    "This only takes it out of the queue; the Job and application records are kept.",

  "applyQueue.toast.removed": "Removed from the queue",
  "applyQueue.toast.removeFailed": "Could not remove it from the queue",
  "applyQueue.toast.removePartial": "Removed {ok}; {failed} failed",
  "applyQueue.toast.removedCount": "Removed {count} Jobs from the queue",
  "applyQueue.toast.notEligible":
    "The selected items can no longer be applied to — refresh the queue and try again",
  "applyQueue.toast.needBrowser": "Start the browser before applying",
  "applyQueue.toast.startedSelected": "Started applying to {count} selected Jobs",
  "applyQueue.toast.startedAll": "Started applying to the queue",
  "applyQueue.toast.startFailed": "Could not start applying",

  "applyQueue.guide.title": "The queue holds Jobs you plan to apply to but have not applied to yet",
  "applyQueue.guide.step1":
    "Open a Job in Job Square, then click Add to apply desk to queue it (Jobs imported from Auto collect use the same entry).",
  "applyQueue.guide.step2":
    "Check each Job's eligibility verdict here. When unsure, run Match analysis back in Job Square — anything with a real gap is not applied to by default.",
  "applyQueue.guide.step3":
    "Click a Job name to view details or edit it, so you can swap in a better-fitting Resume or rewrite the greeting.",
  "applyQueue.guide.step4":
    "Tick the Jobs for this round (ticking nothing means the whole queue in order), then click Start applying — no recruiting site opens before that.",

  "applyQueue.unsupported.title": "{count} Jobs in the queue cannot be applied to automatically",
  "applyQueue.unsupported.body":
    "Their sources are not job boards the apply desk supports (marked Source not supported in the Job column). Applying to the whole queue will stop on them — click More actions → Remove from queue at the end of each row first. To apply to only some of them, tick those Jobs and click Start applying.",
  "applyQueue.truncated":
    "The queue has {total} Jobs and the list shows only the {shown} most recently added. Narrow it with filters, or apply to what is queued first.",

  "applyQueue.empty.title": "The queue is empty — pick a few Jobs in Job Square first.",
  "applyQueue.empty.body":
    "In Job Square, open a Job and click Add to apply desk to queue it. Back on this page, tick the Jobs you want and click Start applying.",

  "applyQueue.detail.deletedJob": "(Job deleted)",
  "applyQueue.detail.autoApply": "Auto-apply",
  "applyQueue.detail.unsupported": "Source not supported — apply on the original site",
  "applyQueue.detail.supported": "Supported — the source is a job board the desk can apply on",
  "applyQueue.detail.status": "Status",
  "applyQueue.detail.queuePosition": "Queue position",
  "applyQueue.detail.position": "No. {index}",
  "applyQueue.detail.resume": "Resume",
  "applyQueue.detail.defaultResume": "Resolved by default rules",
  "applyQueue.detail.joinedAt": "Added",
  "applyQueue.detail.updatedAt": "Last updated",
  "applyQueue.detail.greeting": "Greeting",
  "applyQueue.detail.defaultGreeting": "Default greeting",

  "applyQueue.admission.needsConfirm": "Confirm each one",
  "applyQueue.admission.unanalyzed": "Not analyzed",

  "applyQueue.column.job": "Job",
  "applyQueue.column.admission": "Admission",
  "applyQueue.column.status": "Status",
  "applyQueue.column.assets": "Resume / Greeting",
  "applyQueue.column.actions": "Actions",
  "applyQueue.table.joinedAt": "Queued at {time}",
  "applyQueue.table.viewDetailAria": "View queue item details: {title}",
  "applyQueue.table.deletedJobShort": "Job deleted",
  "applyQueue.table.unsupportedTag": "Source not supported",
  "applyQueue.table.unsupportedHint":
    "Its source is not a job board the apply desk supports, so it cannot be applied to automatically; remove it from the queue or apply on the original site",
  "applyQueue.table.moreActionsAria": "More actions for {job}",
  "applyQueue.table.total": "{total} in total",

  "applyQueue.filter.byStatus": "Filter by status",
  "applyQueue.filter.byAdmission": "Filter by admission",
  "applyQueue.filter.count": "{total} Jobs, {selected} selected",
  "applyQueue.filter.countFiltered": "{total} Jobs, {shown} shown, {selected} selected",
  "applyQueue.filter.selectAllHint":
    "Tick every applicable Job in the current list (works across pages); ticking nothing applies the whole queue in order",
  "applyQueue.filter.selectAll": "Select all in queue",
  "applyQueue.filter.clearSelection": "Clear selection",
  "applyQueue.confirm.removeSelectedTitle": "Remove the selected Jobs from the queue?",
  "applyQueue.action.removeSelected": "Remove selected",
  "applyQueue.action.start": "Start applying",

  "applyQueue.editor.title": "Edit “{title}”",
  "applyQueue.editor.untitledJob": "this Job",
  "applyQueue.editor.resumeHint":
    "Leave empty to use this Job's latest tailored Resume at run time",
  "applyQueue.editor.resumePlaceholder": "Resolved by default rules (type to search)",
  "applyQueue.editor.generate": "Generate a greeting for this Job",
  "applyQueue.toast.greetingGenerated": "Generated a greeting for this Job",
  "applyQueue.toast.greetingDefault": "Filled in the default greeting (no model configured)",
  "applyQueue.toast.greetingFailed": "Could not generate the greeting",
  "applyQueue.toast.updated": "Queue item updated",
  "applyQueue.toast.updateFailed": "Could not update the queue item",
} as const;

export default applyQueue;
