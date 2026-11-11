// SPDX-License-Identifier: Apache-2.0
/** 技能工作台（与 zh-CN.skills.ts 一一对应）。 */
const skills = {
  "skills.builtin.digest.label": "Resume bullet digest",
  "skills.builtin.digest.hint": "Compress one experience into at most three Resume bullets",
  "skills.builtin.digest.name": "Resume bullet digest",
  "skills.builtin.digest.description":
    "Used when the user pastes an experience and asks for it to be rewritten as Resume bullets",
  "skills.builtin.interview.label": "Interview question forecast",
  "skills.builtin.interview.hint":
    "Predict interview questions from a Job description and outline how to answer",
  "skills.builtin.interview.name": "Interview question forecast",
  "skills.builtin.interview.description":
    "Used when the user prepares for an interview and asks for mock questions",
  "skills.builtin.match.label": "Job fit analysis",
  "skills.builtin.match.hint":
    "Compare a Job description with the Profile and explain matches, gaps and how to close them",
  "skills.builtin.match.name": "Job fit analysis",
  "skills.builtin.match.description":
    "Used when the user asks whether to apply for a Job or how well they fit",

  "skills.toast.deleted": "Deleted skill “{name}”",
  "skills.toast.deleteFailed": "Could not delete the skill",
  "skills.toast.imported": "Imported skill “{name}”",
  "skills.toast.importFailed": "Could not import the skill",

  "skills.action.view": "View / edit",
  "skills.action.delete": "Delete",
  "skills.action.import": "Import skill (.md / .zip)",
  "skills.action.create": "New skill",
  "skills.confirm.delete":
    "Delete the skill “{name}”? No conversation will be able to enable it afterwards.",

  "skills.column.skill": "Skill",
  "skills.column.prompt": "Prompt",
  "skills.column.promptLength": "{count} characters",
  "skills.column.files": "Knowledge files",
  "skills.column.source": "Source",
  "skills.column.updatedAt": "Updated",
  "skills.column.actions": "Actions",
  "skills.none": "None",
  "skills.fileCount": "{count}",

  "skills.breadcrumb": "Workbench",
  "skills.tab.skills": "Skills",
  "skills.guide.whatTitle": "What a skill is",
  "skills.guide.whatBody":
    "A skill has two parts: a prompt, which is added to the assistant's system prompt in the conversations that enable it (for example “keep Resume bullets under 35 characters”), and knowledge files, which the assistant reads on demand (for example a list of common interview questions). A skill only changes how the assistant answers — it never touches your Jobs, Resumes or Profile.",
  "skills.guide.howTitle": "How to use this workbench",
  "skills.guide.how1": "Copy a template below as a starting point, or click New skill;",
  "skills.guide.how2":
    "Be specific with “do …” and “do not …”; after saving, enable it from the skill menu in a conversation;",
  "skills.guide.how3":
    "Skills are enabled in a conversation, not globally in the library: every new conversation starts with none, and Import skill loads a .md / .zip someone else shared.",
  "skills.guide.templates": "Templates:",
  "skills.budget.title":
    "The more skills a conversation enables, the longer the system prompt: once the total prompt size exceeds the budget, later skills are not loaded (the assistant says so in one sentence).",
  "skills.error.loadFailed": "Could not load skills: {error}",
  "skills.empty": "No skills yet — start from a template",

  "skills.editor.detailTitle": "Skill details",
  "skills.editor.createTitle": "New assistant skill",
  "skills.editor.editTitle": "Edit skill details",
  "skills.editor.intro":
    "The skill prompt only applies in conversations that enable it; knowledge files are reference material the assistant reads on demand. After saving, tick it in the skill menu of a conversation.",
  "skills.editor.name": "Skill name",
  "skills.editor.namePlaceholder": "e.g. Resume bullet digest",
  "skills.editor.nameRequired": "Enter a skill name",
  "skills.editor.scenario": "Use case (one sentence on when to use it)",
  "skills.editor.scenarioHint":
    "It is rendered as “Use case: …” so the model can decide when to use the skill; the more specific, the better it matches",
  "skills.editor.scenarioPlaceholder":
    "e.g. Compress an experience into at most three Resume bullets",
  "skills.editor.prompt": "Skill prompt",
  "skills.editor.promptPlaceholder":
    "Describe what you want the assistant to do with explicit requirements such as “do ...” and “do not ...”.\nFor example: when rewriting Resume bullets, keep each under 35 characters and always include an action verb and a checkable result.",
  "skills.editor.promptRequired":
    "Enter the skill prompt; it decides what the assistant does for this skill",
  "skills.editor.promptLong":
    "Long prompt: when several skills are enabled together it may be truncated (this conversation shares {budget} characters)",
  "skills.editor.files": "Knowledge files",
  "skills.editor.filesHint":
    "Read only when the assistant needs them (e.g. common interview questions, company lists)",
  "skills.editor.filesBudget": "{count} / {maxCount} files · {chars} / {maxChars} characters",
  "skills.editor.filesFull":
    "The limit of {maxCount} files is reached; delete one before adding more (or merge content into an existing file)",
  "skills.editor.filesOverBudget":
    "Knowledge files exceed {maxChars} characters in total; trim them before saving",
  "skills.editor.filesTruncated":
    "This skill's knowledge files are very large, so not all of the content was loaded; saving will not change the knowledge files (only the prompt is updated).",
  "skills.editor.filePathPlaceholder": "File name, e.g. interview-questions.md",
  "skills.editor.fileContentPlaceholder": "Knowledge file content (plain text or Markdown)",
  "skills.editor.addFile": "Add knowledge file",
  "skills.editor.removeFile": "Delete knowledge file {path}",
  "skills.editor.loadFailed": "Could not load the skill",
  "skills.editor.saveFailed": "Could not save the skill",
  "skills.editor.created":
    "Created skill “{name}”; tick it in the skill menu of a conversation to use it",
  "skills.editor.saved":
    "Saved skill “{name}”; tick it in the skill menu of a conversation to use it",
  // #31D/E/F skill learning: drafts from conversations, pending badge, 90-day archive hint
  "skills.learning.title": "Create a skill from a conversation",
  "skills.learning.intro":
    "The assistant can spot a reusable workflow in your latest conversation and draft a skill with all four sections. It is saved as Pending validation and never takes effect automatically; review it before ticking it in a conversation.",
  "skills.learning.detect": "Scan latest conversation",
  "skills.learning.detectHint":
    "A draft is offered only when at least one holds: the same workflow appeared in two conversations, you said to always do it this way, or one task completed five consecutive successful steps.",
  "skills.learning.noConversation": "No conversations yet. Chat with the assistant first.",
  "skills.learning.noSignal":
    "No reusable pattern in this conversation (not enough evidence, so nothing is proposed).",
  "skills.learning.detectFailed": "Scan failed. Please try again.",
  "skills.learning.trigger.repeat_workflow": "The same workflow appeared in multiple conversations",
  "skills.learning.trigger.persistent_rule": "You said to always do it this way",
  "skills.learning.trigger.long_success_trajectory":
    "One task completed five consecutive successful steps",
  "skills.learning.modal.title": "Review the skill draft",
  "skills.learning.modal.intro":
    "All four sections are editable. Saved drafts stay Pending validation and never take effect automatically.",
  "skills.learning.modal.triggers": "Why this was suggested",
  "skills.learning.modal.ok": "Save as pending skill",
  "skills.learning.modal.cancel": "Cancel",
  "skills.learning.form.name": "Skill name",
  "skills.learning.form.nameRequired": "Please enter a skill name",
  "skills.learning.form.description": "One-line summary",
  "skills.learning.form.descriptionRequired": "Please write when this applies",
  "skills.learning.form.whenToUse": "When to use",
  "skills.learning.form.whenToUseRequired": "Please write the trigger condition",
  "skills.learning.form.steps": "Steps (one per line)",
  "skills.learning.form.stepsRequired": "Write at least one step",
  "skills.learning.form.pitfalls": "Pitfalls and counter-examples (one per line)",
  "skills.learning.accepted":
    "Saved skill “{name}” (pending validation; not enabled automatically)",
  "skills.learning.saveFailed": "Could not save the skill",
  "skills.learning.pendingBadge": "Pending validation",
  "skills.learning.action.validate": "Mark as validated",
  "skills.learning.validateConfirm":
    "Confirm this skill was actually used and worked correctly? It will be marked as validated.",
  "skills.learning.validated": "Marked as validated",
  "skills.learning.validateFailed": "Could not mark it as validated. Please try again.",
  "skills.learning.archive.title": "{count} generated skills have not been loaded for 90 days",
  "skills.learning.archive.body":
    "These skills have been idle for a long time: keep them or delete them from the list. Nothing is deleted automatically.",
  "skills.learning.archive.item": "{name} (last loaded: {time})",
  "skills.learning.archive.neverLoaded": "never loaded",
} as const;

export default skills;
