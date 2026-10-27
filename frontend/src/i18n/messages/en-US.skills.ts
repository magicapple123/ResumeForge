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

  "skills.toast.toggleFailed": "Could not change the skill state",
  "skills.toast.deleted": "Deleted skill “{name}”",
  "skills.toast.deleteFailed": "Could not delete the skill",
  "skills.toast.imported": "Imported skill “{name}”",
  "skills.toast.importFailed": "Could not import the skill",

  "skills.action.view": "View / edit",
  "skills.action.delete": "Delete",
  "skills.action.import": "Import skill (.md / .zip)",
  "skills.action.create": "New skill",
  "skills.confirm.delete":
    "Delete the skill “{name}”? The assistant will stop following its instructions.",

  "skills.column.skill": "Skill",
  "skills.column.enabled": "Enabled",
  "skills.column.prompt": "Prompt",
  "skills.column.promptLength": "{count} characters",
  "skills.column.files": "Knowledge files",
  "skills.column.source": "Source",
  "skills.column.updatedAt": "Updated",
  "skills.column.actions": "Actions",
  "skills.aria.enable": "Enable the skill “{name}”",
  "skills.aria.disable": "Disable the skill “{name}”",
  "skills.none": "None",
  "skills.fileCount": "{count}",

  "skills.breadcrumb": "Workbench",
  "skills.tab.skills": "Skills",
  "skills.guide.whatTitle": "What a skill is",
  "skills.guide.whatBody":
    "A skill has two parts: a prompt, which is a standing instruction added to the assistant's system prompt (for example “keep Resume bullets under 35 characters”), and knowledge files, which the assistant reads on demand (for example a list of common interview questions). A skill only changes how the assistant answers — it never touches your Jobs, Resumes or Profile.",
  "skills.guide.howTitle": "How to use this workbench",
  "skills.guide.how1": "Copy a template below as a starting point, or click New skill;",
  "skills.guide.how2":
    "Be specific with “do …” and “do not …” — the skill takes effect as soon as you save;",
  "skills.guide.how3":
    "On the assistant page you can toggle skills at any time, and Import skill loads a .md / .zip someone else shared.",
  "skills.guide.templates": "Templates:",
  "skills.budget.title":
    "The more skills are enabled, the longer the system prompt: once the total prompt size exceeds the budget, the remaining skills are not loaded (the assistant says so in one sentence).",
  "skills.error.loadFailed": "Could not load skills: {error}",
  "skills.empty": "No skills yet — start from a template",

  "skills.editor.detailTitle": "Skill details",
  "skills.editor.createTitle": "New assistant skill",
  "skills.editor.editTitle": "Edit skill details",
  "skills.editor.intro":
    "The skill prompt is added to the assistant's system prompt, so it acts as a standing requirement; knowledge files are reference material the assistant reads on demand.",
  "skills.editor.name": "Skill name",
  "skills.editor.namePlaceholder": "e.g. Resume bullet digest",
  "skills.editor.nameRequired": "Enter a skill name",
  "skills.editor.scenario": "Use case (one sentence on when to use it)",
  "skills.editor.scenarioPlaceholder":
    "e.g. Compress an experience into at most three Resume bullets",
  "skills.editor.enabled": "Enabled",
  "skills.editor.prompt": "Skill prompt",
  "skills.editor.promptPlaceholder":
    "Describe what you want the assistant to do with explicit requirements such as “do ...” and “do not ...”.\nFor example: when rewriting Resume bullets, keep each under 35 characters and always include an action verb and a checkable result.",
  "skills.editor.promptRequired":
    "Enter the skill prompt; it decides what the assistant does for this skill",
  "skills.editor.files": "Knowledge files",
  "skills.editor.filesHint":
    "Read only when the assistant needs them (e.g. common interview questions, company lists)",
  "skills.editor.filesTruncated":
    "This skill's knowledge files are very large, so not all of the content was loaded; saving will not change the knowledge files (only the prompt and the switch are updated).",
  "skills.editor.filePathPlaceholder": "File name, e.g. interview-questions.md",
  "skills.editor.fileContentPlaceholder": "Knowledge file content (plain text or Markdown)",
  "skills.editor.addFile": "Add knowledge file",
  "skills.editor.removeFile": "Delete knowledge file {path}",
  "skills.editor.loadFailed": "Could not load the skill",
  "skills.editor.saveFailed": "Could not save the skill",
  "skills.editor.created": "Created skill “{name}”",
  "skills.editor.saved": "Saved skill “{name}”",
} as const;

export default skills;
