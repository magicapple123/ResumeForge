// SPDX-License-Identifier: Apache-2.0
/** Assistant memory settings (#31C) and manual profile entry (#18D). */
const assistantMemory = {
  "assistantMemory.title": "Assistant memory",
  "assistantMemory.intro":
    "The assistant only uses job-search preferences you stated yourself. Add one by hand, or delete the memories you no longer want.",
  /** Trust line on the card head (T23): memory stays local. */
  "assistantMemory.trust.local": "Stored on this device",
  /** Left side of the list header. {count} is the number of rows, paused and replaced included. */
  "assistantMemory.list.count": "Memory · {count}",
  /** Accessible name of the row-level "..." icon button. */
  "assistantMemory.list.menu": "More actions",
  "assistantMemory.empty":
    "No memories yet. Add a target role or salary floor, and the assistant will use it from the next turn.",
  "assistantMemory.loadFailed": "Could not load assistant memory. Please try again.",
  "assistantMemory.autoExtract.label": "Organize memories automatically",
  "assistantMemory.autoExtract.hint":
    "When on, the next time you use the assistant it tidies up your previous conversation and lists what it found below, where you can edit or delete it. Turning this off keeps saved memories.",
  "assistantMemory.autoExtract.enableToast": "Memory extraction is on",
  "assistantMemory.autoExtract.disableToast": "Memory extraction is off",
  "assistantMemory.autoExtract.saveFailed":
    "Could not save the extraction setting. Please try again.",
  /** Injection master switch (T23): on by default; off means no memory reaches the prompt. */
  "assistantMemory.inject.label": "Use memories in chats",
  "assistantMemory.inject.hint":
    "When off, the assistant stops consulting the memories below; the entries themselves stay.",
  "assistantMemory.inject.enableToast": "Memory injection is on",
  "assistantMemory.inject.disableToast": "Memory injection is off",
  "assistantMemory.source.manual": "Manual",
  "assistantMemory.source.extracted": "Extracted",
  "assistantMemory.status.superseded": "Replaced by a newer value",
  "assistantMemory.confidence": "Confidence {percent}%",
  /** One row's meta line: source · updated time (menu + screen-reader text only). */
  "assistantMemory.meta.line": "{source} · {updated}",
  "assistantMemory.updatedAt": "Updated {time}",
  /** Card footnote: memories stay in the local database. */
  "assistantMemory.footnote.privacy":
    "These memories live only in the local database and are never uploaded.",
  /** Mechanism copy folded into the info tooltip. */
  "assistantMemory.injection.info":
    "Each turn injects at most five memories ranked by relevance to your message; turning off “Use memories in chats” injects none.",
  "assistantMemory.injection.infoLabel": "How memories are used",
  "assistantMemory.sourceExcerpt": "“{text}”",
  "assistantMemory.source.label": "Source",
  "assistantMemory.openConversation": "Open source conversation",
  "assistantMemory.action.add": "Add memory",
  "assistantMemory.action.edit": "Edit",
  "assistantMemory.action.delete": "Delete",
  "assistantMemory.action.neverUse": "Never use",
  "assistantMemory.action.cancel": "Cancel",
  "assistantMemory.action.save": "Save changes",
  "assistantMemory.action.create": "Save",
  "assistantMemory.action.clearAll": "Clear all",
  "assistantMemory.deleteConfirm.title": "Delete this memory",
  "assistantMemory.deleteConfirm.body":
    "The assistant will stop using it. The record stays in the database for traceability but disappears from this list.",
  "assistantMemory.deleteConfirm.ok": "Delete memory",
  "assistantMemory.neverUseConfirm.title": "Stop using this memory",
  "assistantMemory.neverUseConfirm.body":
    "The assistant will no longer use it in answers. The row stays in this list (greyed out) and can be restored at any time.",
  "assistantMemory.neverUseConfirm.ok": "Pause this memory",
  "assistantMemory.clearConfirm.title": "Clear all memories",
  "assistantMemory.clearConfirm.body":
    "Deletes all {count} memories one by one. The assistant stops using them and they disappear from this list (records stay in the database for traceability).",
  "assistantMemory.clearConfirm.ok": "Clear all memories",
  "assistantMemory.toast.deleted": "Memory deleted",
  "assistantMemory.toast.neverUse": "Paused; it will no longer be used",
  "assistantMemory.toast.restored": "Restored",
  "assistantMemory.status.suppressed": "Paused",
  "assistantMemory.action.restore": "Restore",
  "assistantMemory.action.history": "History",
  "assistantMemory.history.title": "Change history",
  "assistantMemory.history.empty": "No changes recorded yet",
  "assistantMemory.history.loadFailed": "Could not load the change history",
  "assistantMemory.history.action.create": "Created",
  "assistantMemory.history.action.update": "Edited",
  "assistantMemory.history.action.supersede": "Replaced",
  "assistantMemory.history.action.suppress": "Paused",
  "assistantMemory.history.action.restore": "Restored",
  "assistantMemory.history.action.delete": "Deleted",
  "assistantMemory.history.changed": "{before} → {after}",
  "assistantMemory.search.placeholder": "Search memories",
  "assistantMemory.sort.label": "Sort",
  "assistantMemory.sort.recent": "Recently updated",
  "assistantMemory.sort.kind": "By category",
  "assistantMemory.toast.cleared": "Cleared {count} memories",
  "assistantMemory.toast.saved": "Memory saved",
  "assistantMemory.toast.failed": "Something went wrong. Please try again.",
  "assistantMemory.error.valueRequired": "Please enter the memory content",
  "assistantMemory.form.createTitle": "Add a memory",
  "assistantMemory.form.editTitle": "Edit memory",
  "assistantMemory.form.kind": "Type",
  "assistantMemory.form.kindHint":
    'Only seven kinds of job-search facts are stored. Company size, graduation year and interview feedback go under "Other constraints".',
  "assistantMemory.form.kindLocked": "The type cannot be changed after creation",
  "assistantMemory.form.value": "Content",
  "assistantMemory.form.valuePlaceholder": "One sentence, e.g. only roles in Shanghai or Hangzhou",
  "assistantMemory.form.key": "Sub-key (optional)",
  "assistantMemory.form.keyPlaceholder": "e.g. Shanghai when recording a salary floor by city",
  "assistantMemory.form.keyHint":
    "Only needed to distinguish dimensions of the same type; leave empty when one fact per type is enough.",
  "assistantMemory.form.sensitiveHint":
    "Do not enter ID numbers, phone numbers, bank cards or salary slips; keep stable job-search preferences only.",
  "assistantMemory.kind.target_role": "Target role",
  "assistantMemory.kind.city": "Preferred cities",
  "assistantMemory.kind.salary_floor": "Salary floor",
  "assistantMemory.kind.avoid_company": "Companies to avoid",
  "assistantMemory.kind.work_mode": "Remote preference",
  "assistantMemory.kind.skill_tag": "Tech stack",
  "assistantMemory.kind.constraint": "Other constraints",
} as const;

export default assistantMemory;
