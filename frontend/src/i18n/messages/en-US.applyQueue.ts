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

  "applyQueue.unsupported.chip": "{count} source not supported",
  "applyQueue.unsupported.chipHint":
    "These Jobs come from sources the apply desk cannot drive, so they cannot be applied to automatically; applying to the whole queue stops on them",
  "applyQueue.unsupported.chipTitle": "Remove these {count} items?",
  "applyQueue.unsupported.chipBody":
    "This only takes them out of the queue; the Jobs and application records are kept.",
  "applyQueue.toast.removedUnsupported": "Removed {count} source-unsupported Jobs",
  "applyQueue.truncated":
    "The queue has {total} Jobs and the list shows only the {shown} most recently added. Narrow it with filters, or apply to what is queued first.",

  "applyQueue.guide.trigger": "How it works",
  "applyQueue.guide.triggerAria": "Show how the queue works",

  "applyQueue.startBar.count": "{selected} selected / {eligible} applicable",
  "applyQueue.startBar.hint": "Select nothing to apply the whole queue in order",

  "applyQueue.empty.title": "The queue is empty — pick a few Jobs in Job Square first.",
  "applyQueue.empty.action": "Pick Jobs in Job Square",
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
  "applyQueue.column.score": "Score",
  "applyQueue.score.disclaimer":
    "This reference score is estimated by local rules and meant only for display and self-assessment; it is not a real ATS parsing result or a probability of success. Eligibility still follows the five match verdicts.",
  "applyQueue.score.unanalyzed": "Not analyzed",
  "applyQueue.score.sortByScore": "Sort by reference score",
  "applyQueue.score.sortByJoinedAt": "Sort by the time added",
  "applyQueue.table.favorite": "Favorited",
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
  "applyQueue.filter.favoriteOnly": "Favorites only",
  "applyQueue.filter.count": "{total} Jobs, {selected} selected",
  "applyQueue.filter.countFiltered": "{total} Jobs, {shown} shown, {selected} selected",
  "applyQueue.filter.selectAllHint":
    "Tick every applicable Job in the current list (works across pages); ticking nothing applies the whole queue in order",
  "applyQueue.filter.selectAll": "Select all in queue",
  "applyQueue.more.aria": "More queue actions (clear selection)",
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

  "applyQueue.action.preflight": "Check before applying",
  "applyQueue.preflight.title": "Check before applying",
  "applyQueue.preflight.loading": "Checking…",
  "applyQueue.preflight.summary": "{blocking} would be blocked, {warnings} worth fixing first",
  "applyQueue.preflight.blocking": "Would block applying ({count})",
  "applyQueue.preflight.warning": "Fix first if possible ({count})",
  "applyQueue.preflight.empty": "No problems found — safe to apply",
  "applyQueue.preflight.fixLabel": "How to fix: {fix}",
  "applyQueue.preflight.fixRemove": "Remove from queue",
  "applyQueue.preflight.fixEdit": "Fix this item",
  "applyQueue.preflight.fixJobs": "Analyze in Job Square",
  "applyQueue.preflight.confirmTitle": "A note before applying",
  "applyQueue.preflight.confirmBody": "{count} items would be blocked — apply anyway?",
  "applyQueue.preflight.confirmCancel": "Not now",
  "applyQueue.preflight.confirmGo": "Apply anyway",
  "applyQueue.preflight.code.source_unsupported": "Source not supported",
  "applyQueue.preflight.code.resume_missing": "Resume missing",
  "applyQueue.preflight.code.match_missing": "Not analyzed",
  "applyQueue.preflight.code.match_weak": "Weak match",
  "applyQueue.preflight.code.greeting_weak": "Weak greeting",
  "applyQueue.preflight.code.ghost_job": "Possibly a ghost Job",

  "applyQueue.template.pick": "Pick a template",
  "applyQueue.template.pickPlaceholder": "Choose a greeting template",
  "applyQueue.template.preview": "It would read: {text}",
  "applyQueue.template.loadFailed": "Could not load templates; you can still write the greeting",
  "applyQueue.template.batch": "Apply a template in bulk",
  "applyQueue.template.batchTitle": "Apply to the {count} selected",
  "applyQueue.template.batchBody":
    "Variables are rendered from each item's Job and company; you can still edit every one afterwards.",
  "applyQueue.template.batchApply": "Apply template",
  "applyQueue.template.batchDone": "Applied to {count} items",
  "applyQueue.template.batchPartial": "Applied to {ok}, {failed} failed",
  "applyQueue.template.batchEmpty": "Pick a template first",

  "applyQueue.insights.inspect.action": "Inspect",
  "applyQueue.insights.inspect.title": "Job check-up: {job}",
  "applyQueue.insights.inspect.untitledJob": "this Job",
  "applyQueue.insights.inspect.loading": "Running the check-up…",
  "applyQueue.insights.inspect.error":
    "The check-up did not run; the queue and applying are unaffected, so you can continue.",
  "applyQueue.insights.inspect.salary.label": "Pay gap",
  "applyQueue.insights.inspect.salary.ok":
    "Same-city median is {median}K, this Job is {target}K, {delta}",
  "applyQueue.insights.inspect.salary.high": "{percent}% higher",
  "applyQueue.insights.inspect.salary.low": "{percent}% lower",
  "applyQueue.insights.inspect.salary.same": "about the same",
  "applyQueue.insights.inspect.salary.insufficient": "Not enough samples ({sample})",
  "applyQueue.insights.inspect.salary.hint":
    "This compares your own past applications in the same city and Job family — it is not a market pay report.",
  "applyQueue.insights.inspect.sameCompany.label": "Same company",
  "applyQueue.insights.inspect.sameCompany.line":
    "{applied} applied / {in_queue} still queued, {count} in total for this company",
  "applyQueue.insights.inspect.sameCompany.none":
    "You have not applied to this company, and none of its other Jobs are queued.",
  "applyQueue.insights.inspect.history.label": "Past results",
  "applyQueue.insights.inspect.history.none": "You have not applied to this Job yet.",
  "applyQueue.insights.inspect.history.summary": "Applied {applied} times: {parts}",
  "applyQueue.insights.inspect.history.succeeded": "{count} succeeded",
  "applyQueue.insights.inspect.history.failed": "{count} failed",
  "applyQueue.insights.inspect.history.noReply": "{count} no reply",

  "applyQueue.insights.fit.action": "Optimize assignments",
  "applyQueue.insights.fit.title": "Optimize Resume assignment",
  "applyQueue.insights.fit.loading": "Calculating keyword coverage…",
  "applyQueue.insights.fit.error":
    "Keyword coverage could not be calculated; the queue is unaffected, so you can continue.",
  "applyQueue.insights.fit.empty":
    "None of these items has a better-fitting Resume, so keeping them is fine.",
  "applyQueue.insights.fit.column.job": "Job",
  "applyQueue.insights.fit.column.current": "Current Resume",
  "applyQueue.insights.fit.column.coverage": "Coverage",
  "applyQueue.insights.fit.column.recommended": "Recommended Resume",
  "applyQueue.insights.fit.column.after": "After swap",
  "applyQueue.insights.fit.column.gain": "Gain",
  "applyQueue.insights.fit.column.action": "Action",
  "applyQueue.insights.fit.coverage": "{percent}%",
  "applyQueue.insights.fit.gain": "+{gain}",
  "applyQueue.insights.fit.recommendInline":
    "Recommended Resume: {title} (keyword coverage {from}% → {to}%)",
  "applyQueue.insights.fit.swap": "Swap",
  "applyQueue.insights.fit.swapAll": "Swap all",
  "applyQueue.insights.fit.applied": "Swapped {count} items",
  "applyQueue.insights.fit.applyPartial": "Swapped {ok}, {failed} failed",
  "applyQueue.insights.fit.applyFailed": "Could not swap",
  "applyQueue.insights.fit.noGain": "Already the best coverage",
  "applyQueue.insights.fit.swapped": "Swapped",
  "applyQueue.insights.fit.hintError":
    "Keyword coverage is unavailable right now; you can still pick a Resume manually.",

  "applyQueue.insights.stopping.insufficient":
    "Not enough samples ({applied} applications): apply to a few more before judging the marginal return.",
  "applyQueue.insights.stopping.past":
    "Diminishing returns: interview rate over the last {weeks} weeks is {recent}%, below the earlier baseline of {baseline}% ({applied} applications so far).",
  "applyQueue.insights.stopping.followup": "Follow up on pending replies",
  "applyQueue.insights.stopping.improve": "Improve the Resume",

  "applyQueue.insights.ghost.badge": "Ghost {score}",
  "applyQueue.insights.ghost.popoverTitle": "May not be hiring",
  "applyQueue.insights.ghost.hint":
    "Scored from your own re-collection history for this Job, not a platform verdict.",
  "applyQueue.insights.ghost.emptyEvidence": "Not enough re-collections yet.",
  "applyQueue.insights.ghost.ignore": "Ignore this Job",
  "applyQueue.insights.ghost.ignoreTitle": "Stop flagging it?",
  "applyQueue.insights.ghost.ignoreBody": "Only this badge is hidden; the Job stays in the queue.",
  "applyQueue.insights.ghost.ignoreOk": "Ignore flag",
  "applyQueue.insights.ghost.ignored": "Ghost flag ignored for this Job",
  "applyQueue.insights.ghost.ignoreFailed": "Could not ignore it; please try again",

  "applyQueue.insights.jdChange.badge": "The Job you applied to changed",
  "applyQueue.insights.jdChange.title": "Job description changed",
  "applyQueue.insights.jdChange.passive": "Passive: updated on the next collection",
  "applyQueue.insights.jdChange.before": "Previous collection",
  "applyQueue.insights.jdChange.after": "This collection",
  "applyQueue.insights.jdChange.seenAt": "Collected at {time}",
  "applyQueue.insights.jdChange.seenAtUnknown": "No second collection recorded yet",
  "applyQueue.insights.jdChange.unchanged": "Nothing changed since the previous collection.",
  "applyQueue.insights.jdChange.empty": "This Job has no second version to compare yet.",
  "applyQueue.insights.jdChange.error":
    "Change details are unavailable; your application records are unaffected.",
  "applyQueue.insights.jdChange.noId":
    "This record has no matching queue item, so there is no before/after to show.",
  "applyQueue.insights.jdChange.added": "Added",
  "applyQueue.insights.jdChange.removed": "Removed",
} as const;

export default applyQueue;
