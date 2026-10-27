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
} as const;

export default skills;
