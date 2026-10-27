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
} as const;

export default applyQueue;
